#!/bin/bash
set -e

# EC2 Instance Initialization Script for Video Conference Application
# This script automates the complete setup of the application on AWS EC2

echo "=========================================="
echo "Starting EC2 Instance Setup"
echo "=========================================="

# Update system packages
echo "Updating system packages..."
apt-get update
apt-get upgrade -y

# Install Docker
echo "Installing Docker..."
apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

echo \
  "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Install Docker Compose (standalone)
echo "Installing Docker Compose..."
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Start Docker service
echo "Starting Docker service..."
systemctl start docker
systemctl enable docker

# Install additional utilities
echo "Installing utilities..."
apt-get install -y \
    git \
    wget \
    curl \
    htop \
    vim \
    certbot \
    python3-certbot-nginx

# Create application directory
echo "Creating application directory..."
APP_DIR="/opt/videoconference"
mkdir -p $APP_DIR
cd $APP_DIR

# Clone or copy repository (adjust based on your setup)
# For this example, we'll assume the code is provided via S3 or similar
echo "Setting up application files..."

# Create necessary directories
mkdir -p $APP_DIR/ssl
mkdir -p $APP_DIR/logs
mkdir -p $APP_DIR/data

# Set proper permissions
chmod 755 $APP_DIR
chmod 755 $APP_DIR/ssl
chmod 755 $APP_DIR/logs

# Create .env file from template
echo "Creating environment configuration..."
cat > $APP_DIR/.env << 'EOF'
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Add your environment variables here
# DATABASE_URL=
# API_KEY=
# etc.
EOF

chmod 600 $APP_DIR/.env

# Create SSL directory with self-signed certificates (for initial setup)
echo "Generating self-signed SSL certificates..."
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout $APP_DIR/ssl/key.pem \
    -out $APP_DIR/ssl/cert.pem \
    -subj "/C=SK/ST=State/L=City/O=Organization/CN=localhost"

chmod 600 $APP_DIR/ssl/key.pem
chmod 644 $APP_DIR/ssl/cert.pem

# Create docker-compose.prod.yaml
echo "Creating docker-compose configuration..."
cat > $APP_DIR/docker-compose.yaml << 'DOCKER_COMPOSE_EOF'
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.prod
    container_name: videoconference-app
    restart: always
    environment:
      - NODE_ENV=production
      - PORT=3000
    expose:
      - "3000"
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    volumes:
      - ./logs:/app/logs

  nginx:
    image: nginx:alpine
    container_name: videoconference-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
      - ./logs/nginx:/var/log/nginx
    depends_on:
      - app
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  app-network:
    driver: bridge
DOCKER_COMPOSE_EOF

# Create nginx.conf
echo "Creating nginx configuration..."
cat > $APP_DIR/nginx.conf << 'NGINX_CONF_EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 20M;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/json application/javascript application/xml+rss 
               application/rss+xml font/truetype font/opentype 
               application/vnd.ms-fontobject image/svg+xml;

    limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;

    upstream app_server {
        server app:3000 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    server {
        listen 80;
        server_name _;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl http2;
        server_name _;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;

        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }

        location /api/ {
            limit_req zone=api burst=50 nodelay;
            proxy_pass http://app_server;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_buffering off;
            proxy_request_buffering off;
        }

        location /socket.io {
            limit_req zone=api burst=100 nodelay;
            proxy_pass http://app_server;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "Upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_buffering off;
            proxy_request_buffering off;
        }

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            limit_req zone=general burst=20 nodelay;
            proxy_pass http://app_server;
            proxy_cache_valid 200 30d;
            proxy_cache_bypass $http_pragma $http_authorization;
            add_header Cache-Control "public, max-age=2592000, immutable";
            expires 30d;
        }

        location / {
            limit_req zone=general burst=20 nodelay;
            proxy_pass http://app_server;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_buffering off;
            proxy_request_buffering off;
        }
    }
}
NGINX_CONF_EOF

# Create Dockerfile.prod
echo "Creating Dockerfile..."
cat > $APP_DIR/Dockerfile.prod << 'DOCKERFILE_EOF'
FROM node:20-bullseye-slim AS builder

RUN set -x \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server-app ./server-app
COPY client-app ./client-app

WORKDIR /app/client-app
RUN npm ci --only=production
RUN npm run build

WORKDIR /app/server-app
RUN npm ci --only=production
RUN npm run build

FROM node:20-bullseye-slim

RUN set -x \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/server-app/dist ./dist
COPY --from=builder /app/server-app/node_modules ./node_modules
COPY --from=builder /app/server-app/package.json ./package.json
COPY --from=builder /app/client-app/dist ./public

RUN mkdir -p /app/logs && chmod 755 /app/logs

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
DOCKERFILE_EOF

# Create systemd service for docker-compose
echo "Creating systemd service..."
cat > /etc/systemd/system/videoconference.service << 'SYSTEMD_EOF'
[Unit]
Description=Video Conference Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/videoconference
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

chmod 644 /etc/systemd/system/videoconference.service
systemctl daemon-reload

# Configure firewall (UFW)
echo "Configuring firewall..."
apt-get install -y ufw
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp

# Create log rotation configuration
echo "Setting up log rotation..."
cat > /etc/logrotate.d/videoconference << 'LOGROTATE_EOF'
/opt/videoconference/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 root root
    sharedscripts
    postrotate
        docker-compose -f /opt/videoconference/docker-compose.yaml exec -T nginx nginx -s reload > /dev/null 2>&1 || true
    endscript
}
LOGROTATE_EOF

# Create monitoring script
echo "Creating monitoring script..."
cat > /opt/videoconference/monitor.sh << 'MONITOR_EOF'
#!/bin/bash

# Simple health check and restart script
COMPOSE_FILE="/opt/videoconference/docker-compose.yaml"
COMPOSE_DIR="/opt/videoconference"

cd $COMPOSE_DIR

# Check if containers are running
if ! docker-compose ps | grep -q "Up"; then
    echo "$(date): Containers not running, attempting restart..."
    docker-compose up -d
fi

# Check application health
if ! curl -sf http://localhost/health > /dev/null 2>&1; then
    echo "$(date): Health check failed, restarting..."
    docker-compose restart app
fi
MONITOR_EOF

chmod +x /opt/videoconference/monitor.sh

# Create cron job for monitoring
echo "Setting up monitoring cron job..."
cat > /etc/cron.d/videoconference-monitor << 'CRON_EOF'
*/5 * * * * root /opt/videoconference/monitor.sh >> /var/log/videoconference-monitor.log 2>&1
CRON_EOF

# Create backup script
echo "Creating backup script..."
cat > /opt/videoconference/backup.sh << 'BACKUP_EOF'
#!/bin/bash

BACKUP_DIR="/opt/videoconference/backups"
mkdir -p $BACKUP_DIR

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"

echo "Creating backup: $BACKUP_FILE"
tar -czf $BACKUP_FILE \
    -C /opt/videoconference \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    .

# Keep only last 7 backups
find $BACKUP_DIR -name "backup_*.tar.gz" -mtime +7 -delete

echo "Backup completed successfully"
BACKUP_EOF

chmod +x /opt/videoconference/backup.sh

# Create daily backup cron job
echo "Setting up backup cron job..."
cat > /etc/cron.d/videoconference-backup << 'BACKUP_CRON_EOF'
0 2 * * * root /opt/videoconference/backup.sh >> /var/log/videoconference-backup.log 2>&1
BACKUP_CRON_EOF

# Create README for the instance
echo "Creating documentation..."
cat > $APP_DIR/README.md << 'README_EOF'
# Video Conference Application - AWS EC2 Deployment

## Instance Setup Complete

This EC2 instance has been automatically configured with:

- Docker and Docker Compose
- Nginx reverse proxy with SSL/TLS
- Application containers
- Monitoring and health checks
- Automated backups
- Firewall configuration

## Quick Commands

### Start/Stop Application
```bash
cd /opt/videoconference
docker-compose up -d      # Start
docker-compose down       # Stop
docker-compose logs -f    # View logs
```

### View Status
```bash
docker-compose ps
curl https://localhost/health
```

### Update SSL Certificates
```bash
# For Let's Encrypt (requires domain)
certbot certonly --standalone -d yourdomain.com
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem /opt/videoconference/ssl/cert.pem
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem /opt/videoconference/ssl/key.pem
docker-compose restart nginx
```

### View Logs
```bash
# Application logs
docker-compose logs -f app

# Nginx logs
docker-compose logs -f nginx

# System logs
tail -f /var/log/videoconference-monitor.log
tail -f /var/log/videoconference-backup.log
```

### Manual Backup
```bash
/opt/videoconference/backup.sh
```

## Monitoring

- Health checks run every 5 minutes
- Automatic container restart on failure
- Logs are rotated daily
- Backups created daily at 2 AM

## Security

- Firewall enabled (UFW)
- Only ports 22, 80, 443 open
- Non-root user for application
- SSL/TLS encryption
- Security headers configured

## Troubleshooting

### Containers won't start
```bash
cd /opt/videoconference
docker-compose logs
```

### Port already in use
```bash
sudo lsof -i :80
sudo lsof -i :443
```

### Disk space issues
```bash
docker system prune -a
```

## Next Steps

1. Update `.env` file with your configuration
2. Replace self-signed certificates with valid SSL certificates
3. Configure your domain name
4. Set up automated backups to S3 or similar
5. Configure monitoring and alerting

README_EOF

echo "=========================================="
echo "EC2 Instance Setup Complete!"
echo "=========================================="
echo ""
echo "Application directory: /opt/videoconference"
echo "Configuration file: /opt/videoconference/.env"
echo "SSL certificates: /opt/videoconference/ssl/"
echo ""
echo "To start the application:"
echo "  cd /opt/videoconference"
echo "  docker-compose up -d"
echo ""
echo "To view logs:"
echo "  docker-compose logs -f"
echo ""
echo "For more information, see: /opt/videoconference/README.md"
echo ""

# Log completion
echo "Setup completed at $(date)" >> /var/log/videoconference-setup.log
