#!/bin/bash
# ============================================================
# FeedDeck Deploy Script
# Run this on your Beelink server after pushing code changes.
#
# Usage:
#   ./scripts/deploy.sh
#
# What it does:
#   1. Pulls latest code from git
#   2. Installs any new dependencies
#   3. Rebuilds the frontend
#   4. Restarts the FeedDeck service
# ============================================================

set -e

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[✓]${NC} $1"; }

FEEDDECK_DIR="$HOME/feeddeck"
cd "$FEEDDECK_DIR"

log "Pulling latest code..."
git pull

log "Installing dependencies..."
npm install --production=false

log "Building frontend..."
npm run build

log "Restarting FeedDeck..."
sudo systemctl restart feeddeck

sleep 2
if sudo systemctl is-active --quiet feeddeck; then
    log "Deploy complete! FeedDeck is running."
else
    echo "Something went wrong. Check logs:"
    echo "  journalctl -u feeddeck -n 30"
fi
