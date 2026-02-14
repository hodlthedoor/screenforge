#!/bin/bash
# Deploy ScreenForge nginx config with SSL
# Usage: sudo bash deploy-nginx.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_SRC="$SCRIPT_DIR/nginx-screenforge.conf"
CONF_DST="/etc/nginx/sites-available/screenforge"
LINK_DST="/etc/nginx/sites-enabled/screenforge"

if [[ $EUID -ne 0 ]]; then
  echo "Error: This script must be run with sudo."
  echo "Usage: sudo bash $0"
  exit 1
fi

echo "Installing nginx config..."
cp "$CONF_SRC" "$CONF_DST"
ln -sf "$CONF_DST" "$LINK_DST"

echo "Testing nginx config..."
nginx -t

echo "Reloading nginx..."
systemctl reload nginx

echo ""
echo "Done! ScreenForge is now served via nginx with SSL."
echo ""
echo "Add this to /etc/hosts if not already present:"
echo "  YOUR_SERVER_IP screenforge.local"
echo ""
echo "Access at: https://screenforge.local"
