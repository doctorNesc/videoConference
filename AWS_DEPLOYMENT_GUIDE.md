# AWS EC2 Deployment Guide - Video Conference Application

## Overview

This guide provides step-by-step instructions for deploying the Video Conference application on AWS EC2 with automated setup using Docker and Docker Compose.

## Prerequisites

- AWS Account with EC2 access
- Basic knowledge of AWS EC2, security groups, and SSH
- Domain name (optional but recommended for SSL)
- SSH key pair for EC2 access

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    AWS EC2 Instance                  │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │         Nginx (Port 80, 443)                 │   │
│  │  - Reverse Proxy                             │   │
│  │  - SSL/TLS Termination                       │   │
│  │  - Rate Limiting                             │   │
│  │  - Static File Caching                       │   │
│  └──────────────────────────────────────────────┘   │
│                      ↓                               │
│  ┌──────────────────────────────────────────────┐   │
│  │    Node.js Application (Port 3000)           │   │
│  │  - Express Server                            │   │
│  │  - Socket.IO                                 │   │
│  │  - Mediasoup                                 │   │
│  │  - Angular Frontend (Static)                 │   │
│  └──────────────────────────────────────────────┘   │
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │         System Services                      │   │
│  │  - Docker & Docker Compose                   │   │
│  │  - Monitoring & Health Checks                │   │
│  │  - Log Rotation                              │   │
│  │  - Automated Backups                         │   │
│  │  - Firewall (UFW)                            │   │
│  └──────────────────────────────────────────────┘   │
│                                                       │
└─────────────────────────────────────────────────────┘
```

## Step 1: Launch EC2 Instance

### 1.1 Create EC2 Instance

1. Go to AWS EC2 Dashboard
2. Click "Launch Instances"
3. Configure instance:
   - **AMI**: Ubuntu Server 22.04 LTS (or later)
   - **Instance Type**: t3.medium or larger (recommended: t3.large for production)
   - **Storage**: 30GB+ (gp3 recommended)
   - **Network**: Default VPC or your custom VPC

### 1.2 Configure Security Group

Create or select a security group with these inbound rules:

| Protocol | Port | Source | Purpose |
|----------|------|--------|---------|
| TCP | 22 | Your IP | SSH access |
| TCP | 80 | 0.0.0.0/0 | HTTP |
| TCP | 443 | 0.0.0.0/0 | HTTPS |

### 1.3 Create/Select Key Pair

- Create a new key pair or use existing one
- Download and secure the `.pem` file
- Set permissions: `chmod 400 your-key.pem`

## Step 2: Automated Setup with User Data

### 2.1 Prepare the Setup Script

The `ec2-init.sh` script automates the entire setup process. You have two options:

#### Option A: Using User Data (Recommended)

1. In EC2 launch wizard, go to "Advanced Details"
2. Paste the contents of `ec2-init.sh` into "User data" field
3. Launch the instance

#### Option B: Manual Execution

1. Launch instance without user data
2. SSH into instance:
   ```bash
   ssh -i your-key.pem ubuntu@your-instance-ip
   ```
3. Clone or upload your repository:
   ```bash
   git clone https://github.com/your-repo/videoconference.git
   cd videoconference
   ```
4. Run the setup script:
   ```bash
   chmod +x ec2-init.sh
   sudo ./ec2-init.sh
   ```

### 2.2 What the Script Does

The `ec2-init.sh` script automatically:

- Updates system packages
- Installs Docker and Docker Compose
- Creates application directory (`/opt/videoconference`)
- Generates self-signed SSL certificates
- Creates Docker Compose configuration
- Creates Nginx configuration
- Sets up systemd service
- Configures firewall (UFW)
- Creates monitoring scripts
- Sets up automated backups
- Creates log rotation

**Estimated time**: 5-10 minutes

## Step 3: Post-Deployment Configuration

### 3.1 SSH into Instance

```bash
ssh -i your-key.pem ubuntu@your-instance-ip
```

### 3.2 Update Environment Variables

```bash
cd /opt/videoconference
sudo nano .env
```

Update with your configuration:
- `NODE_ENV=production`
- `PORT=3000`
- `MEDIASOUP_ANNOUNCED_IP=your-instance-public-ip`
- Any other required variables

### 3.3 Start the Application

```bash
cd /opt/videoconference
sudo docker-compose up -d
```

### 3.4 Verify Deployment

```bash
# Check container status
sudo docker-compose ps

# View logs
sudo docker-compose logs -f

# Test health endpoint
curl http://localhost/health
```

## Step 4: SSL/TLS Configuration

### 4.1 Using Self-Signed Certificates (Development)

Already configured by the setup script. Access via:
```
https://your-instance-ip
```

### 4.2 Using Let's Encrypt (Production)

1. Install Certbot:
   ```bash
   sudo apt-get install certbot python3-certbot-nginx
   ```

2. Obtain certificate:
   ```bash
   sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
   ```

3. Copy certificates:
   ```bash
   sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem /opt/videoconference/ssl/cert.pem
   sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem /opt/videoconference/ssl/key.pem
   sudo chown 644 /opt/videoconference/ssl/cert.pem
   sudo chown 600 /opt/videoconference/ssl/key.pem
   ```

4. Restart Nginx:
   ```bash
   sudo docker-compose restart nginx
   ```

5. Set up auto-renewal:
   ```bash
   sudo certbot renew --dry-run
   ```

## Step 5: Domain Configuration

### 5.1 Update DNS Records

Point your domain to the EC2 instance:

```
A Record: yourdomain.com → your-instance-public-ip
A Record: www.yourdomain.com → your-instance-public-ip
```

### 5.2 Update Nginx Configuration

Edit `/opt/videoconference/nginx.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    # ... rest of configuration
}
```

Restart Nginx:
```bash
sudo docker-compose restart nginx
```

## Step 6: Monitoring and Maintenance

### 6.1 View Logs

```bash
# Application logs
sudo docker-compose logs -f app

# Nginx logs
sudo docker-compose logs -f nginx

# System logs
sudo tail -f /var/log/videoconference-monitor.log
sudo tail -f /var/log/videoconference-backup.log
```

### 6.2 Health Checks

Health checks run automatically every 5 minutes. Manual check:

```bash
curl https://yourdomain.com/health
```

### 6.3 Container Management

```bash
# View status
sudo docker-compose ps

# Restart application
sudo docker-compose restart app

# Restart all services
sudo docker-compose restart

# Stop services
sudo docker-compose down

# View resource usage
sudo docker stats
```

### 6.4 Disk Space Management

```bash
# Check disk usage
df -h

# Clean up Docker
sudo docker system prune -a

# View container sizes
sudo docker ps -s
```

## Step 7: Backup and Recovery

### 7.1 Automated Backups

Backups run daily at 2 AM. Location: `/opt/videoconference/backups/`

### 7.2 Manual Backup

```bash
cd /opt/videoconference
sudo ./backup.sh
```

### 7.3 Restore from Backup

```bash
cd /opt/videoconference
sudo tar -xzf backups/backup_YYYYMMDD_HHMMSS.tar.gz
sudo docker-compose up -d
```

## Step 8: Performance Optimization

### 8.1 Instance Type Recommendations

| Use Case | Instance Type | vCPU | Memory | Network |
|----------|---------------|------|--------|---------|
| Development | t3.small | 2 | 2GB | Low |
| Small Production | t3.medium | 2 | 4GB | Moderate |
| Medium Production | t3.large | 2 | 8GB | Moderate |
| Large Production | t3.xlarge | 4 | 16GB | High |
| High Performance | c5.large | 2 | 4GB | High |

### 8.2 Nginx Optimization

Already configured in `nginx.conf`:
- Gzip compression
- Connection pooling
- Rate limiting
- Static file caching

### 8.3 Application Optimization

Monitor and adjust in `.env`:
- `LOG_LEVEL=info` (reduce to `warn` in production)
- `MEDIASOUP_MIN_PORT` and `MEDIASOUP_MAX_PORT`
- Connection timeouts

## Step 9: Security Hardening

### 9.1 Firewall Configuration

Already configured by setup script:

```bash
# View firewall rules
sudo ufw status

# Add custom rule
sudo ufw allow from 203.0.113.0/24 to any port 22
```

### 9.2 SSH Security

```bash
# Disable password authentication
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
# Set: PubkeyAuthentication yes

sudo systemctl restart ssh
```

### 9.3 Regular Updates

```bash
# Check for updates
sudo apt update
sudo apt list --upgradable

# Install updates
sudo apt upgrade -y

# Reboot if needed
sudo reboot
```

### 9.4 Monitor Security

```bash
# Check failed login attempts
sudo grep "Failed password" /var/log/auth.log | wc -l

# View active connections
sudo netstat -tulpn | grep LISTEN
```

## Step 10: Troubleshooting

### 10.1 Containers Won't Start

```bash
# Check logs
sudo docker-compose logs

# Check Docker daemon
sudo systemctl status docker

# Restart Docker
sudo systemctl restart docker
```

### 10.2 Port Already in Use

```bash
# Find process using port
sudo lsof -i :80
sudo lsof -i :443

# Kill process
sudo kill -9 <PID>
```

### 10.3 High CPU/Memory Usage

```bash
# Check resource usage
sudo docker stats

# Check system resources
top
free -h

# Restart container
sudo docker-compose restart app
```

### 10.4 SSL Certificate Issues

```bash
# Check certificate validity
openssl x509 -in /opt/videoconference/ssl/cert.pem -text -noout

# Check certificate expiration
openssl x509 -in /opt/videoconference/ssl/cert.pem -noout -dates
```

### 10.5 Network Issues

```bash
# Test connectivity
curl -v https://yourdomain.com

# Check DNS resolution
nslookup yourdomain.com

# View network interfaces
ip addr show
```

## Step 11: Scaling Considerations

### 11.1 Load Balancing

For multiple instances:

1. Create Application Load Balancer (ALB)
2. Configure target group with EC2 instances
3. Update security groups to allow ALB traffic
4. Point domain to ALB DNS name

### 11.2 Auto Scaling

1. Create AMI from configured instance
2. Create launch template
3. Create Auto Scaling Group
4. Configure scaling policies

### 11.3 Database Considerations

If adding database:

1. Use AWS RDS for managed database
2. Update `.env` with `DATABASE_URL`
3. Configure security group for database access
4. Run migrations

## Step 12: Cost Optimization

### 12.1 Reserved Instances

- Purchase 1-year or 3-year reserved instances for 30-50% savings
- Use Savings Plans for flexible commitment

### 12.2 Spot Instances

- Use for non-critical workloads
- Can save up to 90% on compute costs

### 12.3 Data Transfer

- Use CloudFront CDN for static content
- Minimize data transfer between regions
- Use VPC endpoints for AWS services

### 12.4 Monitoring Costs

```bash
# View AWS Billing Dashboard
# Set up cost alerts
# Use AWS Cost Explorer
```

## Useful Commands Reference

```bash
# Application Management
cd /opt/videoconference
sudo docker-compose up -d          # Start
sudo docker-compose down           # Stop
sudo docker-compose restart        # Restart
sudo docker-compose logs -f        # View logs
sudo docker-compose ps             # Status

# System Management
sudo systemctl status videoconference
sudo systemctl restart videoconference
sudo systemctl enable videoconference

# Monitoring
sudo docker stats
sudo docker-compose exec app curl http://localhost:3000/health
sudo tail -f /var/log/videoconference-monitor.log

# Backup
sudo /opt/videoconference/backup.sh
ls -lh /opt/videoconference/backups/

# Updates
sudo apt update && sudo apt upgrade -y
sudo docker-compose pull
sudo docker-compose up -d
```

## Support and Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [AWS EC2 Documentation](https://docs.aws.amazon.com/ec2/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)

## Next Steps

1. ✅ Deploy instance using this guide
2. ✅ Configure SSL certificates
3. ✅ Set up domain name
4. ✅ Configure monitoring and alerting
5. ✅ Set up automated backups to S3
6. ✅ Configure CDN (CloudFront)
7. ✅ Set up database (if needed)
8. ✅ Configure auto-scaling
9. ✅ Set up CI/CD pipeline
10. ✅ Monitor costs and optimize

---

**Last Updated**: 2026-03-19
**Version**: 1.0
