# Deployment Guide

**Complete guide for deploying MetabolicSuite to production**

---

## Table of Contents

- [Deployment Options](#deployment-options)
- [Static Hosting](#static-hosting)
- [Docker Deployment](#docker-deployment)
- [Cloud Platforms](#cloud-platforms)
- [Jupyter Widget Deployment](#jupyter-widget-deployment)
- [Environment Configuration](#environment-configuration)
- [Monitoring and Logging](#monitoring-and-logging)
- [Security Best Practices](#security-best-practices)

---

## Deployment Options

| Platform | Difficulty | Cost | Best For |
|---------|-----------|------|-----------|
| **Netlify** | Easy | Free (tier) | Static sites, continuous deployment |
| **Vercel** | Easy | Free (tier) | Static sites, fast CDN |
| **GitHub Pages** | Easy | Free | Documentation sites, demos |
| **Docker** | Medium | Varies | Self-hosted, custom domains |
| **AWS S3** | Medium | Low | Static hosting, global CDN |
| **Nginx/Apache** | Medium | Free (self-hosted) | Full control, enterprise |

---

## Static Hosting

### Netlify Deployment

**Prerequisites**:
- Netlify account (free)
- Git repository (GitHub, GitLab, Bitbucket)

**Steps**:

1. **Connect Repository**:
   ```bash
   # Install Netlify CLI
   npm install -g netlify-cli
   
   # Login
   netlify login
   ```

2. **Configure Build Settings** (`netlify.toml`):
   ```toml
   [build]
     command = "npm run build"
     publish = "dist"
   
   [build.environment]
     NODE_ENV = "production"
   
   [[redirects]]
     from = "/*"
     to = "/index.html"
     status = 200
     force = true
   ```

3. **Deploy**:
   ```bash
   # Deploy
   netlify deploy --prod
   
   # Or deploy with CLI
   netlify deploy --dir=dist
   
   # Enable automatic deploys from Git
   netlify init
   ```

4. **Verify Deployment**:
   - Open Netlify dashboard
   - Check deployment logs
   - Test production URL

### Vercel Deployment

**Prerequisites**:
- Vercel account (free)
- Git repository

**Steps**:

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   vercel login
   ```

2. **Configure Project** (`vercel.json`):
   ```json
   {
     "buildCommand": "npm run build",
     "outputDirectory": "dist",
     "framework": null,
     "installCommand": "npm install"
   }
   ```

3. **Deploy**:
   ```bash
   vercel --prod
   ```

4. **Configure Domain**:
   - Vercel provides `.vercel.app` subdomain
   - Add custom domain in dashboard
   - Configure SSL (automatic with Vercel)

### GitHub Pages Deployment

**Prerequisites**:
- GitHub account
- Repository on GitHub

**Steps**:

1. **Configure Vite** (`vite.config.js`):
   ```javascript
   export default defineConfig({
     base: '/metabolic-suite/',  // Repository name
     build: {
       outDir: 'dist',
       assetsDir: 'assets'
     }
   });
   ```

2. **Create `gh-pages` Branch**:
   ```bash
   git checkout --orphan gh-pages
   git reset --hard main
   npm run build
   git add dist
   git commit -m "Deploy to GitHub Pages"
   git push origin gh-pages
   ```

3. **Configure GitHub**:
   - Navigate to repository Settings → Pages
   - Source: `gh-pages` branch
   - Root: `/dist`
   - Custom domain: optional

4. **Verify**:
   - Access: `https://username.github.io/metabolic-suite/`
   - Wait 1-2 minutes for build

---

## Docker Deployment

### Dockerfile

Create `Dockerfile` in project root:
```dockerfile
# Multi-stage build for smaller image
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM nginx:alpine AS production

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
```

### Docker Compose

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  metabolic-suite:
    build: .
    ports:
      - "80:80"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/"]
      interval: 30s
      timeout: 10s
      retries: 3
    volumes:
      - ./data:/usr/share/nginx/html/data  # Mount data directory
```

**Deploy with Docker Compose**:
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f metabolic-suite

# Stop
docker-compose down

# Rebuild
docker-compose up -d --build
```

### Docker Image to Registry

**Push to Docker Hub**:
```bash
# Tag image
docker tag metabolic-suite:latest username/metabolic-suite:latest

# Login to Docker Hub
docker login

# Push
docker push username/metabolic-suite:latest
```

**Push to GitHub Container Registry**:
```bash
# Tag image
docker tag metabolic-suite:latest ghcr.io/username/metabolic-suite:latest

# Login to GitHub
echo $GITHUB_TOKEN | docker login ghcr.io -u username --password-stdin

# Push
docker push ghcr.io/username/metabolic-suite:latest
```

---

## Cloud Platforms

### AWS S3 + CloudFront

**Prerequisites**:
- AWS account
- S3 bucket created
- Route53 domain configured (optional)

**Steps**:

1. **Install AWS CLI**:
   ```bash
   pip install awscli
   aws configure
   ```

2. **Sync to S3**:
   ```bash
   aws s3 sync dist/ s3://your-bucket-name/ --delete
   ```

3. **Configure CloudFront**:
   - Create CloudFront distribution
   - Set S3 bucket as origin
   - Configure cache behaviors

4. **Invalidate Cache**:
   ```bash
   aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
   ```

### Google Cloud Storage + Firebase Hosting

**Prerequisites**:
- Google Cloud project
- Firebase project

**Steps**:

1. **Initialize Firebase**:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init
   ```

2. **Configure for static hosting**:
   ```json
   {
     "hosting": {
       "public": "dist",
       "ignore": [
         "firebase.json",
         "**/.*",
         "**/node_modules/**"
       ],
       "rewrites": [
         {
           "source": "**",
           "destination": "/index.html"
         }
       ]
     }
   }
   ```

3. **Deploy**:
   ```bash
   firebase deploy
   ```

### Microsoft Azure Static Web Apps

**Prerequisites**:
- Azure account
- Static Web App resource

**Steps**:

1. **Create Resource**:
   ```bash
   # Install Azure CLI
   npm install -g azure-cli
   
   # Login
   az login
   
   # Create resource group
   az group create --name metabolic-suite-rg --location eastus
   
   # Create static web app
   az staticwebapp create \
     --name metabolic-suite \
     --resource-group metabolic-suite-rg \
     --location eastus \
     --sku Standard
   ```

2. **Deploy**:
   ```bash
   # Deploy using local git
   az webapp up \
     --name metabolic-suite \
     --resource-group metabolic-suite-rg
   
   # Or deploy from zip
   npm run build
   cd dist
   zip -r ../app.zip *
   az webapp deployment source config-zip \
     --resource-group metabolic-suite-rg \
     --name metabolic-suite \
     --src app.zip
   ```

---

## Jupyter Widget Deployment

### Deploy to PyPI

**Prerequisites**:
- Python 3.8+
- PyPI account
- `twine` package

**Steps**:

1. **Update Version** (`python/pyproject.toml`):
   ```toml
   [project]
   name = "metabolicsuite"
   version = "0.1.0"
   
   [project.urls]
   Homepage = "https://github.com/username/metabolic-suite"
   
   [project.optional-dependencies]
   anywidget = "metabolicsuite[widget]"
   ```

2. **Build Package**:
   ```bash
   cd python
   python -m build
   ```

3. **Check Package**:
   ```bash
   # Check contents
   tar -tzvf dist/*.tar.gz
   
   # Check metadata
   twine check dist/*
   ```

4. **Upload to Test PyPI**:
   ```bash
   twine upload --repository-url https://test.pypi.org/legacy/ dist/*
   ```

5. **Upload to Production PyPI**:
   ```bash
   twine upload dist/*
   ```

6. **Verify Installation**:
   ```bash
   pip install metabolicsuite
   python -c "from metabolicsuite import PathwayMap; print('OK')"
   ```

### Conda Deployment

**Prerequisites**:
- Anaconda or Miniconda
- Conda account (for distribution)

**Steps**:

1. **Create Recipe** (`meta.yaml`):
   ```yaml
   package:
     name: metabolicsuite
     version: "0.1.0"
   
   source:
     url: https://github.com/username/metabolic-suite/archive/v{{ version }}.tar.gz
   
   build:
     number: 0
   
   requirements:
     - python >=3.8
     - anywidget
   
   about:
     home: https://github.com/username/metabolic-suite
     license: MIT
     summary: Web-based metabolic modeling platform
   ```

2. **Build Package**:
   ```bash
   conda build .
   ```

3. **Upload to Conda**:
   ```bash
   anaconda upload --user username dist/
   ```

---

## Environment Configuration

### Production Variables

Create `.env.production`:
```bash
NODE_ENV=production
VITE_API_URL=https://api.example.com
VITE_ENABLE_ANALYTICS=true
VITE_GA_TRACKING_ID=UA-XXXXX-XX
```

### Development Variables

Create `.env.development`:
```bash
NODE_ENV=development
VITE_API_URL=http://localhost:3000
VITE_ENABLE_ANALYTICS=false
```

### Loading Environment Variables in Code

```javascript
const API_URL = import.meta.env.VITE_API_URL || 'https://api.example.com';
const ENABLE_ANALYTICS = import.meta.env.VITE_ENABLE_ANALYTICS === 'true';

// Usage
if (ENABLE_ANALYTICS && typeof gtag !== 'undefined') {
  gtag('config', 'GA_TRACKING_ID');
}
```

---

## Monitoring and Logging

### Client-Side Logging

**Error Tracking**:
```javascript
// Log errors to external service (optional)
window.addEventListener('error', (event) => {
  if (import.meta.env.PROD) {
    sendErrorToService({
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack
    });
  }
});
```

**Performance Monitoring**:
```javascript
// Core Web Vitals (optional)
import { onCLS, onFID, onLCP } from 'web-vitals';

onCLS((metric) => {
  console.log('CLS:', metric.value);
  // Send to analytics
});

onFID((metric) => {
  console.log('FID:', metric.value);
  // Send to analytics
});

onLCP((metric) => {
  console.log('LCP:', metric.value);
  // Send to analytics
});
```

### Server-Side Monitoring (for self-hosted)

**Nginx Access Logs**:
```nginx
# /etc/nginx/conf.d/default.conf
access_log /var/log/nginx/access.log;
error_log /var/log/nginx/error.log;
```

**Log Analysis**:
```bash
# Monitor traffic
tail -f /var/log/nginx/access.log

# Analyze with GoAccess
goaccess /var/log/nginx/access.log -o report.html

# Real-time monitoring with htop
htop
```

---

## Security Best Practices

### Content Security Policy

**CSP Header** (Nginx):
```nginx
# /etc/nginx/conf.d/security.conf
add_header Content-Security-Policy "
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self';
  font-src 'self';
  object-src 'none';
  media-src 'self';
  frame-src 'none';
";
```

### HTTPS Configuration

**Force HTTPS** (Netlify):
```toml
[[redirects]]
  from = "http://*"
  to = "https://:splat/:splat"
  status = 301
  force = true
```

**SSL Certificate** (self-hosted):
```bash
# Use Let's Encrypt for free SSL
sudo apt-get install certbot
sudo certbot certonly --webroot -w /var/www/html -d yourdomain.com
```

### Rate Limiting

**Nginx Configuration**:
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
  location /api/ {
    limit_req zone=api burst=20 nodelay;
    # Handle request
  }
}
```

---

## Continuous Integration/Deployment

### GitHub Actions

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Deploy to Netlify
        uses: nwtgck/actions-netlify@v1.2
        with:
          publish-dir: './dist'
          production-branch: main
          github-token: ${{ secrets.GITHUB_TOKEN }}
          deploy-message: "Deploy v${{ github.sha }}"
```

### GitLab CI

Create `.gitlab-ci.yml`:
```yaml
image: node:18

stages:
  - build
  - deploy

build:
  stage: build
  script:
    - npm install
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 week

deploy:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add --no-cache curl
  script:
    - curl -X POST "https://api.netlify.com/api/v1/deploys" -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" -F "dir=@dist"
  only:
    - main
```

---

## Backup and Recovery

### Database Backups (if applicable)

```bash
# Backup production data
mysqldump -u username -p dbname > backup.sql
mongodump --db dbname --out backup.json
```

### Static File Backups

```bash
# Backup deployment
tar -czf backup-$(date +%Y%m%d).tar.gz /path/to/deployment

# Restore
tar -xzf backup-YYYYMMDD.tar.gz
```

### Disaster Recovery Plan

1. **Regular Backups**: Daily automated backups
2. **Offsite Storage**: Backups stored in different region
3. **Recovery Testing**: Monthly restoration drills
4. **Documentation**: Recovery procedures documented
5. **Contact Plan**: Emergency contact list

---

## Performance Tuning

### CDN Configuration

**Netlify**:
- Automatic CDN included
- Asset optimization enabled by default

**Vercel**:
- Edge caching
- Automatic image optimization
- Global CDN

### Caching Strategy

**Cache-Control Headers** (Nginx):
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}

location ~* \.(html|json)$ {
  expires 1h;
  add_header Cache-Control "public";
}
```

### Gzip Compression

**Nginx Configuration**:
```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript
           application/json application/javascript application/xml+rss
           application/rss+xml font/truetype font/opentype
           image/svg+xml;
```

---

## Troubleshooting Deployment

### Issue: White Screen on Load

**Symptoms**:
- Blank page
- Console shows no errors
- Network tab shows 200 OK

**Solutions**:
1. Check production build completed successfully
2. Verify `dist/index.html` exists
3. Check browser console for JavaScript errors
4. Clear browser cache
5. Try incognito/private browsing

### Issue: API 404 Errors

**Symptoms**:
- API calls return 404
- Resources not loading

**Solutions**:
1. Verify API URL is correct in production environment
2. Check CORS configuration
3. Verify API is deployed and accessible
4. Check firewall rules

### Issue: High Memory Usage

**Symptoms**:
- Browser crashes
- Slow performance
- "Out of memory" errors

**Solutions**:
1. Use subsystem view for large models
2. Close other browser tabs
3. Increase browser memory limit
4. Reduce model size (remove unused subsystems)

### Issue: Mixed Content Errors

**Symptoms**:
- Browser blocks resources
- Console warning about mixed content

**Solutions**:
1. Ensure all resources served over HTTPS
2. Check CDN configuration
3. Verify SSL certificate is valid
4. Remove HTTP redirects from HTTPS site

---

## Rollback Strategy

### Quick Rollback (Netlify)

```bash
# Rollback to previous deployment
netlify rollback

# Rollback to specific deploy
netlify rollback --site-id YOUR_SITE_ID
```

### GitHub Pages Rollback

```bash
# Reset gh-pages branch to previous commit
git checkout gh-pages
git reset --hard HEAD~1
git push origin gh-pages --force

# Or checkout specific commit
git checkout gh-pages
git reset --hard COMMIT_HASH
git push origin gh-pages --force
```

### Docker Rollback

```bash
# Stop current container
docker-compose down

# Pull previous image
docker pull username/metabolic-suite:PREVIOUS_TAG

# Restart with previous version
docker-compose up -d
```

---

## Post-Deployment Checklist

- [ ] Build completed successfully
- [ ] All files uploaded
- [ ] Homepage loads correctly
- [ ] Navigation works
- [ ] No console errors
- [ ] Performance is acceptable
- [ ] SSL is configured correctly
- [ ] Analytics are tracking
- [ ] Backups are enabled
- [ ] Monitoring is active
- [ ] Documentation is updated

---

## Next Steps

- Monitor [application performance](#monitoring-and-logging)
- Review [security practices](#security-best-practices)
- Check [troubleshooting guide](./TROUBLESHOOTING.md) for common issues
- Plan [updates and maintenance](./CHANGELOG.md)

---

*Last Updated: December 25, 2025*
