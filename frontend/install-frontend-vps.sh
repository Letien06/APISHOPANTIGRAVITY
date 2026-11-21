#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

docker compose -f frontend/compose.yaml up -d --build

for attempt in {1..20}; do
  usage_code=$(curl --silent --max-time 2 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:20132/usage || true)
  admin_code=$(curl --silent --max-time 2 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:20131/ || true)
  if [[ "$usage_code" == "200" && "$admin_code" == "200" ]]; then
    break
  fi
  sleep 1
done

if [[ "$usage_code" != "200" || "$admin_code" != "200" ]]; then
  printf 'Frontend chua san sang (usage=%s, admin=%s).\n' "$usage_code" "$admin_code" >&2
  docker compose -f frontend/compose.yaml ps >&2
  docker compose -f frontend/compose.yaml logs --tail 20 >&2
  exit 1
fi

blocked_admin=$(curl --silent --max-time 3 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:20132/admin/v1/keys)
if [[ "$blocked_admin" != "404" ]]; then
  printf 'Canh bao: origin cong khai 20132 phai tra 404 cho /admin/v1/keys (hien tra %s).\n' "$blocked_admin" >&2
  exit 1
fi

printf 'FRONTEND READY: usage=127.0.0.1:20132 (200), admin=127.0.0.1:20131 (200), public /admin/v1/keys=404\n'
