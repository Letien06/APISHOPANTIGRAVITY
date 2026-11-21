#!/usr/bin/env bash
set -euo pipefail

stage_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/4 Dong bo full danh sach model Google Gemini (khong co Carbon, khong Claude) tu 9Router"
router_key=$(sed -n 's/^ROUTER_API_KEY=//p' /opt/9router-gateway/.env | head -n 1)
if [[ -n "$router_key" ]]; then
  if catalog=$(printf 'header = "Authorization: Bearer %s"\n' "$router_key" |
      curl --config - -fsS --max-time 12 http://127.0.0.1:20128/v1/models); then
    printf '%s' "$catalog" | python3 -c '
import json, sys

data = json.load(sys.stdin).get("data", [])
gemini_ids = sorted(
    {
        m["id"]
        for m in data
        if isinstance(m.get("id"), str)
        and m["id"].startswith(("ag/gemini", "antigravity/gemini"))
        and "carbon" not in m["id"].lower()
    },
    key=lambda mid: (
        0 if "4-neon" in mid else
        1 if "4-argon" in mid else
        2 if "4-hydrogen" in mid else
        3 if "3.8-flash" in mid else
        4 if "3.1-pro" in mid else
        5 if "pro-agent" in mid else
        6,
        mid,
    ),
)

if not gemini_ids:
    sys.exit(1)

entries = []
for mid in gemini_ids:
    is_flash = "flash" in mid.lower()
    entries.append({
        "id": mid,
        "inputMicrosPerMillion": 300000 if is_flash else 1250000,
        "outputMicrosPerMillion": 2500000 if is_flash else 10000000,
        "maxInputTokens": 32768 if is_flash else 65536,
        "maxOutputTokens": 4096 if is_flash else 8192,
        "chatOutputLimitField": "max_tokens",
    })

with open("/opt/9router-gateway/models.json", "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=2)
    f.write("\n")

print(f"Da dong bo {len(entries)} model Google Gemini (da loai Carbon/Claude):")
for e in entries:
    print("  -", e["id"])
'
  else
    echo "Canh bao: Khong doc duoc /v1/models tu 9Router, giu nguyen models.json hien co." >&2
  fi
fi
unset router_key

echo "==> 2/4 Cap nhat backend gateway (/opt/9router-gateway)"
mkdir -p /opt/9router-gateway/src
cp -f "$stage_dir/src/config.mjs" /opt/9router-gateway/src/config.mjs
cp -f "$stage_dir/src/store.mjs" /opt/9router-gateway/src/store.mjs
cp -f "$stage_dir/src/server.mjs" /opt/9router-gateway/src/server.mjs
cp -f "$stage_dir/src/upstream.mjs" /opt/9router-gateway/src/upstream.mjs

(
  cd /opt/9router-gateway
  docker compose up -d --build --force-recreate
)

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

echo "==> 3/4 Cap nhat giao dien Model Passport (/opt/9router-frontend)"
mkdir -p /opt/9router-frontend
rm -rf /opt/9router-frontend/frontend
cp -r "$stage_dir/frontend" /opt/9router-frontend/frontend
bash /opt/9router-frontend/frontend/install-frontend-vps.sh

echo "==> 4/4 Chuyen Caddy 9Router Dashboard sang admin.tiencoder.tech (giu nguyen mat khau)"
if [[ -s /opt/9router-admin/Caddyfile ]]; then
  sed -i 's/http:\/\/tiencoder\.tech:20130/http:\/\/admin.tiencoder.tech:20130/g; s/https:\/\/tiencoder\.tech/https:\/\/admin.tiencoder.tech/g' /opt/9router-admin/Caddyfile
  docker restart 9router-admin-proxy >/dev/null
  sleep 2
  caddy_code=$(curl --silent --max-time 3 --output /dev/null --write-out '%{http_code}' \
    -H 'Host: admin.tiencoder.tech' -H 'X-Forwarded-Proto: https' http://127.0.0.1:20130/dashboard || true)
  if [[ "$caddy_code" != "401" ]]; then
    echo "CANH BAO: Caddy cho admin.tiencoder.tech tra HTTP $caddy_code (ky vong 401)." >&2
  else
    echo "Caddy OK: admin.tiencoder.tech:20130 tra 401 Basic Auth."
  fi
else
  echo "Luu y: Khong tim thay /opt/9router-admin/Caddyfile — bo qua buoc Caddy."
fi

home_code=$(curl --silent --max-time 3 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:20132/)
models_code=$(curl --silent --max-time 3 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:20132/api/public/models)
blocked_code=$(curl --silent --max-time 3 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:20132/admin/v1/users)

printf '\nPORTAL UPGRADE READY: home=%s, public_models=%s, public_admin_blocked=%s\n' \
  "$home_code" "$models_code" "$blocked_code"
