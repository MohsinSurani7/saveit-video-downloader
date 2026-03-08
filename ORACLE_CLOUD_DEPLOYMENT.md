# SaveIt - Oracle Cloud Deployment Guide

## Overview
This guide covers:
1. Building .apk and .aab files for Android
2. Deploying the backend to Oracle Cloud

---

## Part 1: Build .apk and .aab Files

### Prerequisites
- Install EAS CLI: `npm install -g eas-cli`
- Create free Expo account: https://expo.dev/signup
- Login: `eas login`

### Build APK (for testing/direct install)
```bash
eas build --platform android --profile preview
```
This creates an `.apk` file you can install directly on any Android device.

### Build AAB (for Google Play Store)
```bash
eas build --platform android --profile production
```
This creates an `.aab` file for uploading to Google Play Console.

### Important Notes
- First build takes 15-20 minutes
- Download link appears after build completes
- Set your backend URL before building:
  ```bash
  eas env:create --scope project --name EXPO_PUBLIC_DOMAIN --value your-oracle-server-ip:5000
  ```

---

## Part 2: Deploy Backend to Oracle Cloud

### Step 1: Create Oracle Cloud Instance
1. Go to Oracle Cloud Console: https://cloud.oracle.com
2. Create a Compute Instance:
   - Shape: VM.Standard.E2.1.Micro (Always Free)
   - OS: Oracle Linux 8 or Ubuntu 22.04
   - Add SSH key for access

### Step 2: Connect to Your Instance
```bash
ssh -i your-key.pem opc@YOUR_INSTANCE_IP
```

### Step 3: Install Docker on Oracle Cloud
```bash
# For Oracle Linux
sudo yum install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# For Ubuntu
sudo apt update
sudo apt install -y docker.io docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
```
Log out and log back in after adding docker group.

### Step 4: Open Port 5000 in Firewall

#### Oracle Cloud Security List:
1. Go to Networking > Virtual Cloud Networks
2. Click your VCN > Security Lists > Default Security List
3. Add Ingress Rule:
   - Source CIDR: 0.0.0.0/0
   - Destination Port: 5000
   - Protocol: TCP

#### Instance Firewall:
```bash
# Oracle Linux
sudo firewall-cmd --permanent --add-port=5000/tcp
sudo firewall-cmd --reload

# Ubuntu
sudo ufw allow 5000/tcp
```

### Step 5: Transfer and Build

#### Option A: Clone from Git
```bash
git clone YOUR_REPO_URL saveit
cd saveit
docker build -t saveit-backend .
```

#### Option B: Transfer files directly
On your local machine:
```bash
scp -i your-key.pem -r ./Dockerfile ./package.json ./package-lock.json ./server ./shared ./patches ./app.json ./tsconfig.json ./assets opc@YOUR_INSTANCE_IP:~/saveit/
```
Then on Oracle Cloud:
```bash
cd ~/saveit
docker build -t saveit-backend .
```

### Step 6: Run the Container
```bash
docker run -d \
  --name saveit-backend \
  --restart unless-stopped \
  -p 5000:5000 \
  -e NODE_ENV=production \
  -e PORT=5000 \
  saveit-backend
```

### Step 7: Verify
```bash
curl http://localhost:5000
```
You should see the SaveIt landing page HTML.

From outside:
```bash
curl http://YOUR_INSTANCE_IP:5000
```

---

## Part 3: Connect App to Oracle Cloud Backend

Before building the APK/AAB, set the backend URL:

### For Development (Expo Go)
Set environment variable `EXPO_PUBLIC_DOMAIN` to `YOUR_INSTANCE_IP:5000`

### For Production Build
```bash
eas env:create --scope project --name EXPO_PUBLIC_DOMAIN --value YOUR_INSTANCE_IP:5000
eas build --platform android --profile preview   # for APK
eas build --platform android --profile production # for AAB
```

---

## Useful Docker Commands

```bash
# Check logs
docker logs saveit-backend

# Restart container
docker restart saveit-backend

# Stop container
docker stop saveit-backend

# Remove and rebuild
docker stop saveit-backend
docker rm saveit-backend
docker build -t saveit-backend .
docker run -d --name saveit-backend --restart unless-stopped -p 5000:5000 saveit-backend

# Update yt-dlp inside running container
docker exec saveit-backend pip install --upgrade yt-dlp
```

---

## Optional: HTTPS with Nginx (Recommended)

For production, set up Nginx reverse proxy with SSL:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Configure Nginx
sudo tee /etc/nginx/sites-available/saveit << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 500M;
        proxy_read_timeout 300s;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/saveit /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Get SSL certificate (need a domain pointing to your IP)
sudo certbot --nginx -d your-domain.com
```
