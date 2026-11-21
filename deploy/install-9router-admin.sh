#!/usr/bin/env bash
set -euo pipefail

admin_host=tiencoder.tech
admin_dir=/opt/9router-admin
proxy_name=9router-admin-proxy
proxy_image=caddy:2
proxy_port=20130

if [[ $(id -u) -ne 0 ]]; then
  printf 'Hãy chạy trình cài từ phiên SSH root trên VPS.\n' >&2
  exit 1
fi

router_status=$(curl --silent --show-error --max-time 8 --output /dev/null \
  --write-out '%{http_code}' http://127.0.0.1:20128/login)
if [[ ! "$router_status" =~ ^[23][0-9]{2}$ ]]; then
  printf '9Router ở cổng 20128 trả HTTP %s. Kiểm tra container 9router trước.\n' "$router_status" >&2
  exit 1
fi

install -d -m 0700 "$admin_dir"
if [[ ! -s "$admin_dir/Caddyfile" ]]; then
  admin_password=$(openssl rand -hex 20)
  password_hash=$(printf '%s\n' "$admin_password" |
    docker run --rm -i --entrypoint /usr/bin/caddy "$proxy_image" hash-password)
  if [[ ! "$password_hash" =~ ^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$ ]]; then
    printf 'Caddy không trả về mật khẩu bcrypt hợp lệ.\n' >&2
    exit 1
  fi

  (umask 077; cat > "$admin_dir/Caddyfile" <<EOF
{
  admin off
}

http://${admin_host}:${proxy_port} {
  bind 127.0.0.1

  route {
    @unencrypted not header X-Forwarded-Proto https
    redir @unencrypted https://${admin_host}{uri} 308

    header >Cache-Control "private, no-store"

    basic_auth {
      admin ${password_hash}
    }

    reverse_proxy 127.0.0.1:20128 {
      header_up -Authorization
      header_up X-Forwarded-Proto https
    }
  }
}
EOF
  )
  printf '\nTài khoản cửa bảo vệ dashboard: admin\n'
  printf 'Mật khẩu cửa bảo vệ dashboard: %s\n' "$admin_password"
  printf 'Lưu mật khẩu này. Sau cửa bảo vệ, đăng nhập bằng mật khẩu 9Router hiện tại.\n\n'
  unset password_hash
fi

if docker container inspect "$proxy_name" >/dev/null 2>&1; then
  docker start "$proxy_name" >/dev/null
else
  docker run -d --name "$proxy_name" --restart unless-stopped --network host \
    --mount "type=bind,src=$admin_dir/Caddyfile,dst=/etc/caddy/Caddyfile,readonly" \
    "$proxy_image" >/dev/null
fi

origin=http://127.0.0.1:$proxy_port
for attempt in {1..20}; do
  status=$(curl --silent --max-time 2 --output /dev/null --write-out '%{http_code}' \
    -H "Host: $admin_host" -H 'X-Forwarded-Proto: https' "$origin/dashboard" || true)
  if [[ "$status" == 401 ]]; then
    break
  fi
  sleep 1
done

if [[ "$status" != 401 ]]; then
  printf 'Cửa bảo vệ chưa trả 401. Giữ route Tunnel ở trạng thái chưa xuất bản.\n' >&2
  docker logs --tail 20 "$proxy_name" >&2
  exit 1
fi

status=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \
  -H "Host: $admin_host" -H 'X-Forwarded-Proto: https' "$origin/api/auth/status")
if [[ "$status" != 401 ]]; then
  printf 'Route API quản trị cần trả 401 nếu thiếu mật khẩu.\n' >&2
  exit 1
fi

status=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \
  -H "Host: $admin_host" "$origin/dashboard")
if [[ "$status" != 308 ]]; then
  printf 'Yêu cầu HTTP cần chuyển sang HTTPS với mã 308.\n' >&2
  exit 1
fi

if [[ -v admin_password ]]; then
  status=$(printf 'user = "admin:%s"\n' "$admin_password" |
    curl --config - --silent --show-error --max-time 8 --output /dev/null --write-out '%{http_code}' \
      -H "Host: $admin_host" -H 'X-Forwarded-Proto: https' "$origin/login")
  unset admin_password
  if [[ ! "$status" =~ ^[23][0-9]{2}$ ]]; then
    printf 'Yêu cầu có mật khẩu chưa đến được trang đăng nhập 9Router. HTTP %s.\n' "$status" >&2
    exit 1
  fi
fi

printf 'ADMIN PROXY READY: 127.0.0.1:%s (HTTPS redirect 308, auth 401)\n' "$proxy_port"
