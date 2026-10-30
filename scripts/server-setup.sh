#!/bin/sh
# One-time setup on a fresh Ubuntu server (Hetzner CX22). Run as root:
#   curl -fsSL https://raw.githubusercontent.com/Mohamedhasbini/Pulse/main/scripts/server-setup.sh | sh
set -e
apt-get update -qq && apt-get install -y -qq ca-certificates curl git ufw >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
[ -d /opt/pulse ] || git clone https://github.com/Mohamedhasbini/Pulse.git /opt/pulse
echo "Ready. Next: copy .env and the database dump to /opt/pulse, then run scripts/server-start.sh"
