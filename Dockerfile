# ============================================================
# FeedDeck — single-container dev/QA image
# Bundles Node 22, yt-dlp, Chromium (for Puppeteer scraper),
# and the full app (Vite dev + Express backend).
# ============================================================

FROM node:22-slim

# System deps: yt-dlp, Python, Chromium for Puppeteer, ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    pipx \
    ffmpeg \
    chromium \
    fonts-liberation \
    ca-certificates \
    curl \
    && pipx install yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Make pipx-installed yt-dlp available on PATH
ENV PATH="/root/.local/bin:$PATH"

# Tell Puppeteer to use system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install dependencies (leverage Docker layer caching)
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Copy application code
COPY . .

# Build the Vite frontend
RUN npm run build

# Persistent data volume (SQLite DB, cookies)
VOLUME /app/data

# Express backend serves built frontend + API
# Port 3001 for API, 3000 for Vite dev server
EXPOSE 3000 3001

# Default: run both Vite dev server and Express backend
CMD ["npm", "run", "dev"]
