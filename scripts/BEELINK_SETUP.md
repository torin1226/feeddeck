# FeedDeck Server Setup: Beelink EQ12 (N100)

Your always-on FeedDeck server. This replaces the Raspberry Pi plan from the original docs.

---

## What You're Building

```
┌─────────────────────────────────────────────┐
│  Beelink EQ12 (Intel N100)                  │
├─────────────────────────────────────────────┤
│  Ubuntu Server 24.04 LTS                    │
│  Node.js 22 LTS                             │
│  FeedDeck (Express + React build + SQLite)  │
│  yt-dlp (auto-updating)                     │
├─────────────────────────────────────────────┤
│  Tailscale VPN (secure remote access)       │
│  Runs 24/7 at ~8W                           │
└─────────────────────────────────────────────┘
```

**Access from anywhere:** `http://feeddeck:3000` from any device on your Tailscale network.

---

## Phase 1: Flash Ubuntu (You Do This Manually)

This is the one part that requires physical access and can't be automated.

### What you need

- The Beelink EQ12 (plugged into power + monitor + keyboard)
- A USB flash drive (8GB+)
- Your Windows laptop (to create the USB installer)

### Steps

1. **Download Ubuntu Server 24.04 LTS**
   - Go to: https://ubuntu.com/download/server
   - Click "Download Ubuntu Server 24.04.x LTS"
   - Save the `.iso` file

2. **Create a bootable USB drive**
   - Download Rufus: https://rufus.ie/
   - Run Rufus
   - Select your USB drive under "Device"
   - Click "SELECT" and choose the Ubuntu `.iso` you downloaded
   - Leave everything else default
   - Click "START" and wait (~5 minutes)

3. **Boot the Beelink from USB**
   - Plug the USB drive into the Beelink
   - Power on (or restart) the Beelink
   - Mash `F7` or `Del` during boot to enter boot menu
   - Select the USB drive
   - Choose "Install Ubuntu Server"

4. **Install Ubuntu**
   - Language: English
   - Keyboard: US (or whatever you use)
   - Install type: "Ubuntu Server"
   - Network: It should auto-detect Ethernet. If using WiFi, configure it here.
   - Storage: **Use entire disk** (this wipes Windows — that's fine, you don't need it)
   - Your name: whatever you want
   - Server name: `feeddeck`
   - Username: `torin` (or whatever you prefer)
   - Password: pick something you'll remember
   - **CHECK "Install OpenSSH server"** ← critical, this lets you connect remotely
   - Featured snaps: skip everything, just hit Done
   - Wait for install to finish, then "Reboot Now"
   - Remove the USB drive when prompted

5. **Find your server's IP address**
   - After reboot, log in on the physical keyboard/monitor
   - Run: `ip addr show` 
   - Look for an IP like `192.168.1.XXX` under your ethernet adapter
   - Write this down

6. **Test SSH from your Windows laptop**
   - Open PowerShell
   - Run: `ssh torin@192.168.1.XXX` (use the IP you wrote down)
   - Type "yes" to accept the fingerprint
   - Enter your password
   - If you see a command prompt: you're in. The monitor/keyboard can be unplugged.

---

## Phase 2: Run the Setup Script (Claude Code Does This)

Once you're SSHed into the Beelink, install Claude Code and let it handle the rest.

### Install Claude Code

```bash
# Install Claude Code (requires Node, so we install that first)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g @anthropic-ai/claude-code
```

### Run Claude Code

```bash
claude
```

Then tell it:

> Run the FeedDeck server setup script at `~/feeddeck/scripts/setup-server.sh`

Claude Code will execute the script, handle any errors, and get everything running.

### Or run the script manually

If you'd rather do it yourself:

```bash
# Clone the repo (replace with your actual repo URL)
git clone https://github.com/YOUR_USERNAME/feeddeck.git ~/feeddeck
cd ~/feeddeck

# Make the script executable and run it
chmod +x scripts/setup-server.sh
./scripts/setup-server.sh
```

---

## Phase 3: Tailscale (Access from Anywhere)

This part is interactive — it needs you to click a link to authenticate.

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

This prints a URL like:
```
To authenticate, visit:
  https://login.tailscale.com/a/XXXXXXXXX
```

1. Open that URL on your phone or laptop
2. Sign in (Google account works)
3. Approve the device

Now from **any device** with Tailscale installed:
- `http://feeddeck:3000` → your FeedDeck server

### Install Tailscale on your other devices

- **Windows laptop:** https://tailscale.com/download/windows
- **iPhone/Android:** Search "Tailscale" in the app store
- Sign into the same account on each device

---

## Maintenance

### Check if FeedDeck is running
```bash
sudo systemctl status feeddeck
```

### View logs
```bash
# Last 50 lines
journalctl -u feeddeck -n 50

# Follow live
journalctl -u feeddeck -f
```

### Restart FeedDeck
```bash
sudo systemctl restart feeddeck
```

### Update FeedDeck (after pushing new code)
```bash
cd ~/feeddeck
git pull
npm install
npm run build
sudo systemctl restart feeddeck
```

### Update yt-dlp (do this monthly — sites change constantly)
```bash
yt-dlp --update
```

### Backup the database
```bash
# Manual backup
cp ~/feeddeck/server/feeddeck.db ~/feeddeck-backup-$(date +%Y%m%d).db

# The auto-backup cron (set up by the script) runs daily at 3am
# Backups are in ~/backups/
```

---

## Troubleshooting

### Can't SSH into the Beelink
- Make sure it's powered on and connected to your network
- Check the IP hasn't changed: plug in a monitor and run `ip addr show`
- If on Tailscale: `ssh torin@feeddeck` should work from any Tailscale device

### FeedDeck won't start
```bash
# Check what went wrong
journalctl -u feeddeck -n 100

# Common fixes:
cd ~/feeddeck
npm install          # missing dependencies
npm run build        # frontend not built
```

### yt-dlp errors
```bash
# Update it first (fixes 90% of issues)
yt-dlp --update

# Test it manually
yt-dlp --dump-json "VIDEO_URL"
```

### Server runs out of disk space
```bash
# Check disk usage
df -h

# The 500GB NVMe is plenty for metadata, but if backups pile up:
ls -la ~/backups/
# Delete old ones if needed
```

---

## Hardware Specs (For Reference)

| Component | Spec |
|-----------|------|
| CPU | Intel N100, 4 cores, up to 3.4GHz |
| RAM | 16GB DDR5-4800 |
| Storage | 500GB NVMe SSD |
| Network | Dual 2.5Gbps Ethernet, WiFi 6 |
| Power | ~8W idle, ~15W under load |
| OS | Ubuntu Server 24.04 LTS |
