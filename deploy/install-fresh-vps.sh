#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# TienCoder API - Full Fresh VPS Bootstrap (Ubuntu 22.04 / 24.04)
# Installs:
#   1. Docker + Docker Compose (if missing)
#   2. Antigravity-Manager (127.0.0.1:8045)
#   3. Caddy Admin Proxy for admin.tiencoder.tech (127.0.0.1:20130)
#   4. TienCoder Gateway API + SQLite (127.0.0.1:20129)
#   5. Public Portal & Admin Manage UI (127.0.0.1:20132 & 127.0.0.1:20131)
#   6. cloudflared (installs binary; registers tunnel if TUNNEL_TOKEN provided)
# ==============================================================================

if [[ "${EUID}" -ne 0 ]]; then
  echo "Vui long chay bang quyen root (sudo bash ...)." >&2
  exit 1
fi

BUNDLE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== [1/6] Kiem tra & cai dat goi co ban + Docker ==="
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg openssl

if ! command -v docker >/dev/null 2>&1; then
  echo "Dang cai Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin
fi

# Prompt or accept credentials via environment variables
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "Nhap mat khau dang nhap cho manage.tiencoder.tech & admin.tiencoder.tech (de trong se tu sinh): " ADMIN_PASSWORD
    echo ""
  fi
fi
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9@#%!' | head -c 16)"
fi

WEB_PASSWORD="${WEB_PASSWORD:-$ADMIN_PASSWORD}"
ROUTER_API_KEY="${ROUTER_API_KEY:-sk-ag-$(openssl rand -hex 20)}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 24)}"

echo "=== [2/6] Cai dat Antigravity-Manager (127.0.0.1:8045) ==="
mkdir -p /opt/antigravity-manager/data

cat > /opt/antigravity-manager/.env <<EOF
API_KEY=${ROUTER_API_KEY}
WEB_PASSWORD=${WEB_PASSWORD}
ABV_MAX_BODY_SIZE=104857600
TZ=Asia/Ho_Chi_Minh
EOF
chmod 600 /opt/antigravity-manager/.env

cat > /opt/antigravity-manager/compose.yaml <<'EOF'
services:
  antigravity-manager:
    image: lbjlaq/antigravity-manager:latest
    container_name: antigravity-manager
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:8045:8045"
    volumes:
      - ./data:/root/.antigravity_tools
EOF

(cd /opt/antigravity-manager && docker compose pull && docker compose up -d --force-recreate)

echo "=== [3/6] Cai dat Caddy Admin Proxy cho admin.tiencoder.tech (127.0.0.1:20130) ==="
mkdir -p /opt/9router-admin

cat > /opt/9router-admin/Caddyfile <<'EOF'
{
  auto_https off
}

:20130 {
  @blocked path /v1 /v1/* /v1beta /v1beta/*
  respond @blocked 404
  reverse_proxy 127.0.0.1:8045
}
EOF

cat > /opt/9router-admin/compose.yaml <<'EOF'
services:
  admin-proxy:
    image: caddy:2-alpine
    container_name: 9router-admin-proxy
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
EOF

(cd /opt/9router-admin && docker compose up -d --force-recreate)

echo "=== [4/6] Cai dat TienCoder Gateway API (127.0.0.1:20129) ==="
mkdir -p /opt/9router-gateway/src
cp -f "${BUNDLE_DIR}/Dockerfile" "${BUNDLE_DIR}/compose.yaml" "${BUNDLE_DIR}/.dockerignore" "${BUNDLE_DIR}/package.json" "${BUNDLE_DIR}/models.json" /opt/9router-gateway/
rm -rf /opt/9router-gateway/src
cp -r "${BUNDLE_DIR}/src" /opt/9router-gateway/src

if [[ ! -f /opt/9router-gateway/.env ]]; then
  cat > /opt/9router-gateway/.env <<EOF
HOST=127.0.0.1
PORT=20129
ADMIN_TOKEN=${ADMIN_TOKEN}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ROUTER_BASE_URL=http://127.0.0.1:8045/v1
ROUTER_API_KEY=${ROUTER_API_KEY}
DEFAULT_USER_QUOTA_MICROS=1000000
MAX_KEYS_PER_USER=5
SESSION_TTL_HOURS=168
UPSTREAM_TIMEOUT_MS=600000
MAX_BODY_BYTES=16777216
EOF
  chmod 600 /opt/9router-gateway/.env
else
  echo "Giu nguyen /opt/9router-gateway/.env da ton tai."
fi

(cd /opt/9router-gateway && docker compose up -d --build --force-recreate)

echo "Cho Gateway san sang tren 127.0.0.1:20129..."
gw_ok=0
for _ in $(seq 1 25); do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:20129/healthz || true)" == "200" ]]; then
    gw_ok=1
    break
  fi
  sleep 1
done
if [[ "$gw_ok" -ne 1 ]]; then
  echo "LOI: Gateway 20129 chua len!" >&2
  (cd /opt/9router-gateway && docker compose logs --tail 30) >&2
  exit 1
fi

echo "=== [5/6] Cai dat Frontend Portal (20132) & Admin UI (20131) ==="
mkdir -p /opt/9router-frontend
rm -rf /opt/9router-frontend/frontend
cp -r "${BUNDLE_DIR}/frontend" /opt/9router-frontend/frontend
bash /opt/9router-frontend/frontend/install-frontend-vps.sh

echo "=== [6/6] Cai dat cloudflared (Cloudflare Tunnel) ==="
if ! command -v cloudflared >/dev/null 2>&1; then
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    | tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq cloudflared
fi

if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  cloudflared service uninstall >/dev/null 2>&1 || true
  cloudflared service install "${CLOUDFLARE_TUNNEL_TOKEN}"
  echo "Da ket noi Cloudflare Tunnel thanh cong!"
fi

echo ""
echo "=================================================================="
echo "  CAI DAT TOAN BO HE THONG TIENCODER.TECH THANH CONG!"
echo "=================================================================="
printf '  Antigravity-Manager : 127.0.0.1:8045  (HTTP %s)\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8045/ || true)"
printf '  Caddy Admin Proxy   : 127.0.0.1:20130 (HTTP %s, /v1=%s)\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:20130/ || true)" \
  "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:20130/v1/models || true)"
printf '  Gateway API         : 127.0.0.1:20129 (HTTP %s)\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:20129/healthz || true)"
printf '  Admin Manage UI     : 127.0.0.1:20131 (HTTP %s)\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:20131/ || true)"
printf '  Public Portal UI    : 127.0.0.1:20132 (HTTP %s)\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:20132/ || true)"
echo "------------------------------------------------------------------"
echo "  Dang nhap manage.tiencoder.tech : user=${ADMIN_USERNAME} (xem ADMIN_PASSWORD trong /opt/9router-gateway/.env)"
echo "  Dang nhap admin.tiencoder.tech  : xem WEB_PASSWORD trong /opt/antigravity-manager/.env"
echo "  Luu tru thong tin bi mat tai    : /opt/9router-gateway/.env (quyen 600)"
if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "------------------------------------------------------------------"
  echo "  BUOC CUOI: Chay lenh ket noi Cloudflare Tunnel (lay trong"
  echo "  Cloudflare Zero Trust -> Networks -> Tunnels -> 9router-vps):"
  echo "    cloudflared service install <TUNNEL_TOKEN>"
fi
echo "=================================================================="
