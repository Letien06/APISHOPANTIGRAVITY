#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

for program in curl docker openssl python3; do
  if ! command -v "$program" >/dev/null; then
    printf 'Thiếu lệnh %s trên VPS.\n' "$program" >&2
    exit 1
  fi
done

docker compose version >/dev/null

if [[ -s .env ]]; then
  router_key=$(sed -n 's/^ROUTER_API_KEY=//p' .env | head -n 1)
else
  IFS= read -rsp 'Dán API key 9Router (gateway-vps) rồi Enter: ' router_key
  printf '\n'
fi

router_key=${router_key%$'\r'}
if [[ ! "$router_key" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'ROUTER_API_KEY cần là key từ mục Endpoint của 9Router, ví dụ bắt đầu bằng sk-.\n' >&2
  exit 1
fi

if ! catalog=$(printf 'header = "Authorization: Bearer %s"\n' "$router_key" |
    curl --config - -fsS --max-time 12 http://127.0.0.1:20128/v1/models); then
  printf 'Không đọc được danh sách model 9Router. Kiểm tra container 9router và key gateway-vps.\n' >&2
  exit 1
fi

if [[ ! -s models.json ]]; then
  candidates=$(printf '%s' "$catalog" | python3 -c '
import json, sys
ids = {model["id"] for model in json.load(sys.stdin)["data"]
       if model.get("id", "").startswith(("ag/", "antigravity/"))}
print("\n".join(sorted(ids, key=lambda name: ("flash" not in name.lower(), name))))
')
  if [[ -z "$candidates" ]]; then
    printf '9Router chưa trả model Antigravity. Kết nối provider trong dashboard rồi chạy lại.\n' >&2
    exit 1
  fi

  mapfile -t models <<< "$candidates"
  printf '\nCác model Antigravity mà 9Router trả về:\n'
  for index in "${!models[@]}"; do
    printf '%3d) %s\n' "$((index + 1))" "${models[index]}"
  done
  IFS= read -rp 'Chọn số model đã thử trong 9Router [1]: ' choice
  choice=${choice:-1}
  if [[ ! "$choice" =~ ^[1-9][0-9]{0,3}$ ]] || (( choice > ${#models[@]} )); then
    printf 'Số model không hợp lệ. Chạy lại trình cài.\n' >&2
    exit 1
  fi

  model_config=$(mktemp .models.XXXXXX)
  trap 'rm -f -- "$model_config"' EXIT
  python3 -c '
import json, sys
with open("models.example.json", encoding="utf-8-sig") as source:
    model = json.load(source)[0]
model["id"] = sys.argv[1]
print(json.dumps([model], indent=2))
' "${models[choice - 1]}" > "$model_config"
  chmod 0644 "$model_config"
  mv -- "$model_config" models.json
  trap - EXIT
  printf 'Đã lưu model %s với giá thử nghiệm trong models.json.\n' "${models[choice - 1]}"
fi

if [[ ! -s .env ]]; then
  admin_token=$(openssl rand -hex 32)
  (umask 077; printf 'PORT=20129\nADMIN_TOKEN=%s\nROUTER_API_KEY=%s\n' "$admin_token" "$router_key" > .env)
  unset admin_token
fi
unset router_key catalog

docker compose up -d --build
for attempt in {1..20}; do
  if health=$(curl --silent --fail --max-time 2 http://127.0.0.1:20129/healthz) && [[ "$health" == '{"status":"ok"}' ]]; then
    printf '\nGateway 20129: %s\n' "$health"
    exit 0
  fi
  sleep 1
done

printf 'Gateway chưa trả lời ở cổng 20129.\n' >&2
docker compose ps
docker compose logs --tail 20 gateway
exit 1
