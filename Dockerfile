# --- Build stage ---
FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# --- Production stage ---
FROM node:22-slim

# Install yt-dlp, ffmpeg, Chromium, and curl_cffi for TLS impersonation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    chromium \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && pip3 install --no-cache-dir --break-system-packages curl_cffi \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy server code and built frontend
COPY server/ ./server/
COPY public/ ./public/
COPY --from=build /app/dist ./dist

# Data and cookie-tmp directories with write permissions
RUN mkdir -p /app/data /app/data/.cookie-tmp && chmod -R 777 /app/data

# Use /tmp for cookie temp files (avoids volume permission issues)
ENV COOKIE_TMP_DIR=/tmp/cookie-tmp

# Single port serves both API and frontend
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server/index.js"]
