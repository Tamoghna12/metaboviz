# Installation Guide

**Complete installation instructions for MetabolicSuite**

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Installation](#development-installation)
- [Production Build](#production-build)
- [Jupyter Widget Installation](#jupyter-widget-installation)
- [Docker Installation](#docker-installation)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

**For Web Application**:
- **Node.js**: Version 18.0 or higher
- **npm**: Version 9.0 or higher (comes with Node.js)
  - Alternative: **yarn** Version 1.22 or higher

**For Jupyter Widget** (optional):
- **Python**: Version 3.8 or higher
- **pip**: Package manager for Python

### Required Browser

| Browser | Minimum Version | Recommended | Notes |
|---------|----------------|-------------|-------|
| Chrome | 90 | Latest | Full support |
| Firefox | 88 | Latest | Full support |
| Safari | 14 | Latest | Full support |
| Edge | 90 | Latest | Full support |
| Mobile iOS Safari | 14 | Latest | Full support |
| Mobile Chrome | Latest | Latest | Full support |

**Browser Requirements**:
- JavaScript enabled
- WebAssembly (WASM) support
- LocalStorage enabled (for preferences)
- 512MB+ RAM (2GB+ recommended for large models)

### System Requirements

**Minimum**:
- RAM: 512MB
- Storage: 50MB for application
- CPU: Any modern processor (JavaScript engine)

**Recommended**:
- RAM: 2GB or more
- Storage: 500MB (with models)
- CPU: Multi-core (JavaScript can use Web Workers)
- Screen: 1280×720 resolution or higher

---

## Development Installation

### Step 1: Clone Repository

```bash
# Clone from GitHub
git clone https://github.com/yourusername/metabolic-suite.git
cd metabolic-suite

# Or download and extract
wget https://github.com/yourusername/metabolic-suite/archive/main.zip
unzip main.zip
cd metabolic-suite-main
```

### Step 2: Install Dependencies

#### Using npm (recommended)

```bash
# Install all dependencies
npm install

# Install development-only dependencies (faster)
npm install --only=dev

# Install production-only dependencies
npm install --only=production
```

#### Using yarn (alternative)

```bash
# Install all dependencies
yarn

# Install development-only dependencies
yarn install --dev

# Install production-only dependencies
yarn install --production
```

### Step 3: Verify Installation

```bash
# Check Node.js version
node --version  # Should be v18.0.0 or higher

# Check npm version
npm --version  # Should be 9.0.0 or higher

# Check installed packages
npm list --depth=0

# Expected output:
# metabolic-app@0.0.0
# ├── @testing-library/react@16.3.1
# ├── glpk.js@5.0.0
# ├── react@19.2.0
# └── ...
```

### Step 4: Start Development Server

```bash
# Start Vite dev server (default: http://localhost:5173)
npm run dev

# Alternative: specify port
npm run dev -- --port 3000

# Alternative: specify host
npm run dev -- --host 0.0.0.0
```

**Expected Output**:
```
  VITE v7.2.4  ready in 312 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

### Step 5: Open in Browser

1. Open browser to `http://localhost:5173`
2. You should see the MetabolicSuite interface
3. Default E. coli core model is loaded

---

## Production Build

### Build Web Application

```bash
# Build for production
npm run build

# Output: dist/ directory
#   ├── index.html
#   ├── assets/
#   │   ├── index-[hash].js
#   │   ├── index-[hash].css
#   │   └── ...
```

**Build Options**:
```bash
# Build with debug maps (not for production)
npm run build -- --mode development

# Clean build before rebuild
npm run build && rm -rf dist && npm run build
```

### Build Jupyter Widget

```bash
# Build widget bundle
npm run build:widget

# Output: python/metabolicsuite/static/widget.js
```

### Build All

```bash
# Build both web app and widget
npm run build:all
```

---

## Jupyter Widget Installation

### Step 1: Build Widget

```bash
# Build widget
cd metabolic-suite
npm run build:widget
```

### Step 2: Install Python Package

```bash
# Navigate to Python directory
cd python

# Install in development mode (editable)
pip install -e .

# Or build and install
python -m build
pip install dist/
```

### Step 3: Verify Installation

```bash
# Check installed package
pip show metabolicsuite

# Expected output:
# Name: metabolicsuite
# Version: 0.1.0
# Summary: Web-based metabolic modeling platform
# ...
```

### Step 4: Use in Jupyter

```python
# Start Jupyter
jupyter notebook

# In Jupyter notebook:
from metabolicsuite import PathwayMap
import cobra

# Load a model
model = cobra.io.load_model("textbook")

# Create pathway map widget
map = PathwayMap(model)

# Display widget
map
```

### Alternative: Install from PyPI (when published)

```bash
# Install from PyPI
pip install metabolicsuite

# Use in Jupyter
from metabolicsuite import PathwayMap
```

---

## Docker Installation

### Using Dockerfile

Create `Dockerfile`:
```dockerfile
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
FROM node:18-alpine

WORKDIR /app

# Copy build artifacts
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 8080

# Serve with nginx (simplified)
RUN npm install -g serve
CMD ["serve", "-s", "dist", "-l", "8080"]
```

**Build and Run**:
```bash
# Build Docker image
docker build -t metabolic-suite .

# Run container
docker run -p 8080:8080 metabolic-suite

# Open browser to http://localhost:8080
```

### Using Docker Compose

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  metabolic-suite:
    build: .
    ports:
      - "8080:80"
    environment:
      - NODE_ENV=production
    volumes:
      - ./data:/app/data  # Mount data directory
```

**Run with Docker Compose**:
```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

---

## Verification

### Web Application Verification

```bash
# Run tests
npm run test

# Expected: All tests pass

# Run linter
npm run lint

# Expected: No linting errors

# Check build
npm run build

# Expected: No build errors, dist/ created
```

### Jupyter Widget Verification

```bash
# Import widget
python -c "from metabolicsuite import PathwayMap; print('Widget loaded successfully')"

# Expected output:
# Widget loaded successfully
```

### Manual Verification

**Web Application**:
1. Open http://localhost:5173
2. Upload a model (SBML or JSON)
3. Run FBA
4. Verify results are displayed
5. Check browser console for errors

**Jupyter Widget**:
1. Create new Jupyter notebook
2. Import widget: `from metabolicsuite import PathwayMap`
3. Load model: `model = cobra.io.load_model("textbook")`
4. Create widget: `map = PathwayMap(model)`
5. Display: `map`
6. Verify interactive pathway appears

---

## Troubleshooting

### Common Installation Issues

**Issue: Node.js version too old**

**Error**: `SyntaxError: Unexpected token`

**Solution**:
```bash
# Install Node.js 18 or higher using nvm
nvm install 18
nvm use 18
```

**Issue: npm install fails**

**Error**: `EACCES: permission denied`

**Solution**:
```bash
# Fix permissions
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules

# Or use sudo
sudo npm install
```

**Issue: Port already in use**

**Error**: `Error: listen EADDRINUSE: address already in use :::5173`

**Solution**:
```bash
# Find process using port 5173
lsof -i :5173

# Kill process
kill -9 <PID>

# Or use different port
npm run dev -- --port 3000
```

**Issue: glpk.js WASM not loading**

**Error**: `WebAssembly.instantiate() failed`

**Solution**:
1. Clear browser cache
2. Check browser supports WebAssembly
3. Disable ad-blockers
4. Try different browser

**Issue: Jupyter widget not displaying**

**Error**: `ModuleNotFoundError: No module named 'metabolicsuite'`

**Solution**:
```bash
# Verify installation
pip list | grep metabolicsuite

# Reinstall if needed
pip uninstall metabolicsuite
pip install -e .
```

### Dependency Issues

**Issue: Package vulnerabilities**

**Check**:
```bash
npm audit
```

**Solution**:
```bash
# Run npm audit fix
npm audit fix

# Or manually update vulnerable packages
npm update package-name
```

**Issue: Dependency conflicts**

**Error**: `ERESOLVE unable to resolve dependency tree`

**Solution**:
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Build Issues

**Issue: Build fails with out of memory**

**Error**: `FATAL ERROR: CALL_AND_RETRY_LAST_FAILED: Allocation failed - process out of memory`

**Solution**:
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

**Issue: Production build not working**

**Error**: Blank page or 404 errors

**Solution**:
```bash
# Check base path in vite.config.js
# Verify index.html exists in dist/
# Use absolute base path: base: '/'
# Configure server to handle SPA routing
```

---

## Development Environment Setup

### VS Code Extensions (Recommended)

- **ES7+ JavaScript code snippets**: Enhanced autocomplete
- **Prettier - Code formatter**: Auto-format code
- **ESLint**: Linting and error detection
- **GitLens**: Enhanced Git integration
- **Tailwind CSS IntelliSense**: Tailwind autocomplete

### Git Hooks

Install Husky for git hooks:
```bash
npm install --save-dev husky lint-staged

# Initialize git hooks
npx husky init
```

`.husky/pre-commit`:
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run linting
npm run lint

# Run tests
npm run test
```

---

## Uninstallation

### Uninstall Web Application

```bash
# Stop development server (Ctrl+C)

# Remove repository
rm -rf metabolic-suite

# Clear npm cache (optional)
npm cache clean --force
```

### Uninstall Jupyter Widget

```bash
# Uninstall from Python
pip uninstall metabolicsuite

# Verify
pip list | grep metabolicsuite

# Should return empty
```

---

## Next Steps

After installation, see:

- **[USER_GUIDE.md](./USER_GUIDE.md)**: How to use the application
- **[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)**: How to contribute and develop
- **[API.md](./API.md)**: Complete API reference

---

*Last Updated: December 25, 2025*
