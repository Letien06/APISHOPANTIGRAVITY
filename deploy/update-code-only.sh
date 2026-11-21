#!/usr/bin/env bash
set -euo pipefail

stage_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/2 Cap nhat backend (/opt/9router-gateway/src — giu nguyen .env, models.json, SQLite)"
cp -f "$stage_dir/src/config.mjs" /opt/9router-gateway/src/config.mjs
cp -f "$stage_dir/src/store.mjs" /opt/9router-gateway/src/store.mjs
cp -f "$stage_dir/src/server.mjs" /opt/9router-gateway/src/server.mjs
cp -f "$stage_dir/src/upstream.mjs" /opt/9router-gateway/src/upstream.mjs

(cd /opt/9router-gateway && docker compose up -d --build)

for attempt in {1..20}; do
  gw_ok=$(curl --silent --max-time 2 http://127.0.0.1:20129/healthz || true)
  if [[ "$gw_ok" == '{"status":"ok"}' ]]; then
    break
  fi
  sleep 1
done
if [[ "$gw_ok" != '{"status":"ok"}' ]]; then
  echo "LOI: Gateway 20129 chua khoi dong thanh cong." >&2
  docker compose -f /opt/9router-gateway/compose.yaml logs --tail 25 >&2
  exit 1
fi

echo "==> 2/2 Cap nhat frontend (/opt/9router-frontend/frontend)"
mkdir -p /opt/9router-frontend
rm -rf /opt/9router-frontend/frontend
cp -r "$stage_dir/frontend" /opt/9router-frontend/frontend
bash /opt/9router-frontend/frontend/install-frontend-vps.sh

echo "UPDATE READY: shared-wallet + copy-key + favicon + 21 models preserved!"
