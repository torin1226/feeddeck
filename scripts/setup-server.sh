#!/bin/bash
# ============================================================
# FeedDeck Server Setup Script
# Run this on a fresh Ubuntu Server 24.04 LTS installation.
# It installs all dependencies, builds the app, and configures
# it to run automatically on boot.
#
# Usage:
#   chmod +x scripts/setup-server.sh
#   ./scripts/setup-server.sh
#
# What it does:
#   1. Updates the system
#   2. Installs Node.js 22 LTS
#   3. Installs yt-dlp
#   4. Installs project dependencies (npm install)
#   5. Builds the frontend (npm run build)
#   6. Creates a systemd service (auto-start on boot)
#   7. Sets up daily database backups
#   8. Sets up weekly yt-dlp auto-update
#   9. Starts FeedDeck
# ============================================================

set -e  # Exit on any error

# --- Colors for output ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# --- Sanity checks ---
if [ "$(id -u)" -eq 0 ]; then
    fail "Don't run this as root. Run as your normal user (it uses sudo when needed)."
fi

FEEDDECK_DIR="$HOME/feeddeck"
if [ ! -f "$FEEDDECK_DIR/package.json" ]; then
    fail "Can't find $FEEDDECK_DIR/package.json. Clone the repo first:\n  git clone <your-repo-url> ~/feeddeck"
fi

echo ""
echo "================================================"
echo "  FeedDeck Server Setup"
echo "  Target: $(hostname)"
echo "  User:   $(whoami)"
echo "  Dir:    $FEEDDECK_DIR"
echo "================================================"
echo ""

# ============================================================
# 1. System update
# ============================================================
log "Updating system packages..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential python3 python3-pip ffmpeg
log "System updated."

# ============================================================
# 2. Node.js 22 LTS
# ============================================================
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    log "Node.js already installed: $NODE_VERSION"
    # Check if it's v22+
    MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    if [ "$MAJOR" -lt 22 ]; then
        warn "Node.js $NODE_VERSION is old. Upgrading to v22..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt install -y nodejs
    fi
else
    log "Installing Node.js 22 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
fi
log "Node.js $(node --version) ready."

# ============================================================
# 3. yt-dlp
# ============================================================
if command -v yt-dlp &> /dev/null; then
    log "yt-dlp already installed: $(yt-dlp --version)"
else
    log "Installing yt-dlp..."
    sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    sudo chmod a+rx /usr/local/bin/yt-dlp
fi
log "yt-dlp $(yt-dlp --version) ready."

# ============================================================
# 4. Install npm dependencies
# ============================================================
log "Installing npm dependencies..."
cd "$FEEDDECK_DIR"
npm install --production=false  # Need devDeps for building
log "Dependencies installed."

# ============================================================
# 5. Build frontend
# ============================================================
log "Building frontend..."
npm run build
log "Frontend built."

# ============================================================
# 6. Create systemd service
# ============================================================
log "Creating systemd service..."

SERVICE_FILE="/etc/systemd/system/feeddeck.service"
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=FeedDeck Media Server
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$FEEDDECK_DIR
ExecStart=$(which node) server/index.js
Restart=on-failure
RestartSec=5

# Environment
Environment=NODE_ENV=production
Environment=PORT=3000

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$FEEDDECK_DIR/data
ReadWritePaths=$HOME/backups

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=feeddeck

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable feeddeck
log "Systemd service created and enabled."

# ============================================================
# 7. Daily database backup (3am)
# ============================================================
log "Setting up daily database backups..."

BACKUP_DIR="$HOME/backups"
mkdir -p "$BACKUP_DIR"

BACKUP_SCRIPT="$FEEDDECK_DIR/scripts/backup-db.sh"
cat > "$BACKUP_SCRIPT" <<'BACKUP_EOF'
#!/bin/bash
# Daily FeedDeck database backup
# Keeps the last 14 days of backups

BACKUP_DIR="$HOME/backups"
DB_PATH="$HOME/feeddeck/data/library.db"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

if [ -f "$DB_PATH" ]; then
    # Use SQLite's .backup command for a safe copy (no corruption risk)
    sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/feeddeck_$DATE.db'"
    echo "[backup] Created: feeddeck_$DATE.db"
    
    # Delete backups older than 14 days
    find "$BACKUP_DIR" -name "feeddeck_*.db" -mtime +14 -delete
    echo "[backup] Cleaned up old backups."
else
    echo "[backup] WARNING: Database not found at $DB_PATH"
fi
BACKUP_EOF
chmod +x "$BACKUP_SCRIPT"

# Install sqlite3 for safe backups
sudo apt install -y sqlite3

# Add cron job (runs daily at 3am)
(crontab -l 2>/dev/null | grep -v "backup-db.sh"; echo "0 3 * * * $BACKUP_SCRIPT >> $BACKUP_DIR/backup.log 2>&1") | crontab -
log "Daily backups configured (3am, keeps 14 days)."

# ============================================================
# 8. Weekly yt-dlp auto-update (Sundays at 4am)
# ============================================================
log "Setting up weekly yt-dlp updates..."

(crontab -l 2>/dev/null | grep -v "yt-dlp --update"; echo "0 4 * * 0 /usr/local/bin/yt-dlp --update >> $HOME/backups/ytdlp-update.log 2>&1") | crontab -
log "Weekly yt-dlp updates configured (Sundays 4am)."

# ============================================================
# 9. Start FeedDeck
# ============================================================
log "Starting FeedDeck..."
sudo systemctl start feeddeck

# Wait a moment and check status
sleep 3
if sudo systemctl is-active --quiet feeddeck; then
    log "FeedDeck is running!"
else
    warn "FeedDeck may not have started cleanly. Check logs:"
    echo "  journalctl -u feeddeck -n 30"
fi

# ============================================================
# Done!
# ============================================================
echo ""
echo "================================================"
echo "  Setup complete!"
echo "================================================"
echo ""
echo "  FeedDeck is running at:"
echo "    http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "  Next steps:"
echo "    1. Install Tailscale for remote access:"
echo "       curl -fsSL https://tailscale.com/install.sh | sh"
echo "       sudo tailscale up"
echo ""
echo "    2. Then access from anywhere:"
echo "       http://feeddeck:3000"
echo ""
echo "  Useful commands:"
echo "    sudo systemctl status feeddeck   # Check status"
echo "    journalctl -u feeddeck -f        # Follow logs"
echo "    sudo systemctl restart feeddeck  # Restart"
echo ""
