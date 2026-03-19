# Quick Start Guide - AWS EC2 Deployment

## 5-Minute Setup

### Step 1: Launch EC2 Instance

1. Go to [AWS EC2 Console](https://console.aws.amazon.com/ec2/)
2. Click **Launch Instances**
3. Select **Ubuntu Server 22.04 LTS**
4. Choose instance type: **t3.medium** (minimum)
5. Configure security group:
   - Allow SSH (port 22) from your IP
   - Allow HTTP (port 80) from anywhere
   - Allow HTTPS (port 443) from anywhere

### Step 2: Add User Data Script

In the "Advanced Details" section, copy the contents of `ec2-init.sh` and paste it into the User data field.

### Step 3: Connect and Deploy

```bash
# SSH into instance
ssh -i your-key.pem ubuntu@your-instance-ip

# Clone repository
git clone https://github.com/your-repo/videoconference.git /opt/videoconference
cd /opt/videoconference

# Start application
docker-compose -f docker-compose.prod.yaml up -d

# Check status
docker-compose ps
curl http://localhost/health
```

### Step 4: Configure Domain (Optional)

```bash
# Update DNS to point to instance IP
# Then update nginx.conf with your domain
sudo nano /opt/videoconference/nginx.conf

# Get Let's Encrypt certificate
sudo apt-get install certbot python3-certbot-nginx
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificate
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem /opt/videoconference/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem /opt/videoconference/ssl/key.pem

# Restart nginx
docker-compose restart nginx
```

## Common Commands

```bash
# View logs
docker-compose logs -f app
docker-compose logs -f nginx

# Restart services
docker-compose restart
docker-compose restart app

# Stop services
docker-compose down

# Check health
curl https://yourdomain.com/health

# View resource usage
docker stats
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Containers won't start | `docker-compose logs` to see errors |
| Port 80/443 in use | `sudo lsof -i :80` to find process |
| High memory usage | `docker-compose restart app` |
| SSL certificate error | Check certificate path in nginx.conf |
| Domain not resolving | Wait 24h for DNS propagation |

For detailed guide, see [AWS_DEPLOYMENT_GUIDE.md](AWS_DEPLOYMENT_GUIDE.md)
