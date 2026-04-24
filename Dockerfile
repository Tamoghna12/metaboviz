# MetabolicSuite - Reproducible Build Environment
#
# This Dockerfile creates a deterministic build environment for
# MetabolicSuite, ensuring reproducibility of the web application
# and its HiGHS WASM solver.
#
# Usage:
#   docker build -t metabolicsuite .
#   docker run -p 4173:4173 metabolicsuite
#
# For development:
#   docker run -p 5173:5173 -v $(pwd)/src:/app/src metabolicsuite npm run dev -- --host
#
# For validation (with COBRApy):
#   docker run metabolicsuite python python/run_browser_validation.py --num-models 3

FROM node:22-bookworm-slim AS base

# System dependencies for Playwright (browser-based validation)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js dependencies (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci

# Install Python dependencies for validation
COPY python/pyproject.toml python/
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir numpy cobra

# Copy application source
COPY . .

# Build production bundle
RUN npm run build

# Run tests
RUN npm test

# Production stage
FROM node:22-bookworm-slim AS production

WORKDIR /app
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./

EXPOSE 4173

CMD ["npm", "run", "preview", "--", "--host", "--port", "4173"]
