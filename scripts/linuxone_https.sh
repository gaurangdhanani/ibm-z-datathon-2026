#!/usr/bin/env bash
# FND-8: serve the live demo from the LinuxONE VM over HTTPS, as two systemd services:
#   onetrace   uvicorn on 127.0.0.1:8000 (API + frontend/dist), restarts on failure, starts on boot
#   caddy      reverse proxy on :80 and :443 with an automatic Let's Encrypt certificate
#
# Run ON THE VM (Ubuntu or Red Hat Enterprise Linux 9), from the repo root, after
# scripts/linuxone_setup.sh and with frontend/dist present:
#   scripts/linuxone_https.sh [hostname]
# Without a hostname it uses <public-ip-with-dashes>.sslip.io, a free DNS name that resolves to the
# IP, so no domain is needed. Ports 80 and 443 must be reachable from the internet (Let's Encrypt
# checks port 80). Re-running is safe: it rewrites the config and restarts both services.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
RUN_AS=${USER:-$(id -un)}

IP=$(curl -fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')
DOMAIN=${1:-${IP//./-}.sslip.io}
case "$(uname -m)" in
  s390x) ARCH=s390x ;;
  x86_64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture $(uname -m)"; exit 1 ;;
esac
echo "== $REPO -> https://$DOMAIN  ($ARCH, public IP $IP)"
[ -f frontend/dist/index.html ] || { echo "frontend/dist is missing: run 'make build' on the laptop and rsync again"; exit 1; }
[ -x .venv/bin/uvicorn ] || { echo ".venv is missing: run scripts/linuxone_setup.sh first"; exit 1; }

# 1. Production settings: Secure cookies, no CORS, no /api/docs; the demo personas stay on.
#    A fresh secret re-derives the KMS master key, so the demo data is re-seeded under it.
if ! grep -qs '^ONETRACE_SECRET_KEY=' .env; then
  {
    echo "ONETRACE_ENV=prod"
    echo "ONETRACE_DEMO_MODE=true"
    echo "ONETRACE_SECRET_KEY=$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))')"
  } >> .env
  .venv/bin/python -m onetrace.seed
fi

# 2. Caddy: one static binary from the official download API (built for s390x as well).
if ! command -v caddy >/dev/null; then
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$ARCH" -o /tmp/caddy
  sudo install -m 755 /tmp/caddy /usr/local/bin/caddy
fi
id caddy >/dev/null 2>&1 || sudo useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
sudo mkdir -p /etc/caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8000 {
		flush_interval -1
	}
}
EOF

# 3. systemd units
sudo tee /etc/systemd/system/onetrace.service >/dev/null <<EOF
[Unit]
Description=OneTrace (FastAPI + built frontend)
After=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$REPO
ExecStart=$REPO/.venv/bin/uvicorn onetrace.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
sudo tee /etc/systemd/system/caddy.service >/dev/null <<'EOF'
[Unit]
Description=Caddy (HTTPS reverse proxy for OneTrace)
After=network-online.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
# 4. Firewall: ufw on Ubuntu, firewalld on Red Hat; nothing to do when neither is running.
if command -v ufw >/dev/null && sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
  sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
elif systemctl is-active --quiet firewalld 2>/dev/null; then
  sudo firewall-cmd -q --permanent --add-service=http --add-service=https && sudo firewall-cmd -q --reload
fi

# 5. SELinux (Red Hat enforces it): systemd may not execute files labelled as home-folder content
#    (status=203/EXEC), so label the venv's scripts as programs. New files pip adds inherit it.
if command -v getenforce >/dev/null && [ "$(getenforce)" = "Enforcing" ]; then
  sudo chcon -R -t bin_t "$REPO/.venv/bin"
fi

sudo systemctl daemon-reload
sudo systemctl enable onetrace caddy >/dev/null
sudo systemctl restart onetrace caddy

echo "== waiting for the certificate (Let's Encrypt, usually under a minute)"
for _ in $(seq 1 45); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    echo
    echo "Live: https://$DOMAIN   (open it on your phone; every demo password is onetrace-demo)"
    curl -fsS "https://$DOMAIN/api/health"
    echo
    exit 0
  fi
  sleep 2
done
echo "Not reachable yet. Look at:  sudo journalctl -u caddy -n 50    and    sudo journalctl -u onetrace -n 50"
echo "If ports 80/443 are blocked, add 'tls internal' inside the site block of /etc/caddy/Caddyfile and restart caddy."
exit 1
