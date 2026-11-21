# Giao diện Gateway 9Router (Frontend)

Giao diện tiếng Việt gồm 2 entry point và 2 máy chủ tách biệt hoàn toàn:

| Thành phần | Entry point | Máy chủ | Phạm vi truy cập |
|---|---|---|---|
| **Trang tra cứu công khai `/usage`** | `frontend/public/usage.html` | `frontend/server-public.mjs` | Công khai qua HTTPS / Cloudflare Tunnel |
| **Trang quản trị riêng** | `frontend/admin/index.html` | `frontend/server-admin.mjs` | **Chỉ bind `127.0.0.1`**, mở qua SSH local port forwarding |

- Không dùng thư viện ngoài (chạy trực tiếp bằng Node.js `>= 24`).
- Không sửa đổi backend (`src/`), cơ sở dữ liệu SQLite, `models.json` hay cấu hình Tunnel đang chạy.
- Mọi khóa `gw_` và `ADMIN_TOKEN` chỉ nằm trong bộ nhớ của tab hiện tại, gửi qua header `Authorization: Bearer ...` cùng `cache: 'no-store'`, không lưu vào URL, cookie, `localStorage`, `sessionStorage` hay `IndexedDB`.

---

## 1. Chạy thử cục bộ với dữ liệu Mock

Chạy một lệnh duy nhất để khởi động Mock Gateway + trang `/usage` + trang Admin với đầy đủ kịch bản kiểm thử giả:

```bash
node frontend/dev.mjs
```

Mặc định các dịch vụ chạy trên loopback:
- Trang công khai `/usage`: `http://127.0.0.1:20132/usage`
- Trang quản trị riêng: `http://127.0.0.1:20131/`
- Mock Gateway: `http://127.0.0.1:20199`

Terminal sẽ in ra các khóa giả cục bộ để kiểm thử ngay:
- Khóa đang hoạt động (30 request phân trang 2 trang, gồm `pending`, `usage_missing` + **Ước tính**, `upstream_error` chi phí `0`, `transport_error`, chi phí `1` micro `$0.000001`, và request bị giới hạn bởi khoản giữ chỗ).
- Khóa đã hết hạn (`expired`) — vẫn xem được hạn mức và lịch sử.
- Khóa hết hạn mức (`exhausted`, `remainingMicros = 0`) — vẫn xem được hạn mức và lịch sử.
- Khóa đã vô hiệu hóa (`disabled`) — API trả `401 key_disabled`.
- Khóa lịch sử trống và `models: []`.
- Mã quản trị giả để tạo khóa (hiện một lần), sửa, kiểm thử `409 quota_below_usage`, vô hiệu hóa (`204`) và bật lại.

---

## 2. Chạy kết nối với Gateway thật

### Trên máy chủ (VPS)

1. **Khởi chạy máy chủ giao diện công khai `/usage`** (proxy chỉ đúng allowlist API công khai sang gateway ở cổng ví dụ `20129`):
   ```bash
   PUBLIC_UI_HOST=127.0.0.1 \
   PUBLIC_UI_PORT=20132 \
   GATEWAY_ORIGIN=http://127.0.0.1:20129 \
   node frontend/server-public.mjs
   ```
   Các tuyến được phép trên origin công khai:
   - `GET /usage` và `GET /usage/assets/{usage.css,usage.js,format.js}`
   - `GET /api/usage`, `GET /api/usage/requests`
   - `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses`
   - Toàn bộ đường dẫn khác (`/admin`, `/admin/*`, `/admin/v1/*`, `/healthz`, `/dashboard`, `/`) đều trả **`404`**.

2. **Khởi chạy máy chủ quản trị riêng** (chỉ cho phép bind `127.0.0.1` hoặc `::1`):
   ```bash
   ADMIN_UI_HOST=127.0.0.1 \
   ADMIN_UI_PORT=20131 \
   GATEWAY_ORIGIN=http://127.0.0.1:20129 \
   node frontend/server-admin.mjs
   ```

### Mở giao diện quản trị từ máy cá nhân qua SSH

Dùng SSH local port forwarding (thay `user@vps.example.com` và cổng SSH bằng thông tin máy chủ của bạn):

```bash
ssh -N -L 20131:127.0.0.1:20131 -p 22 user@vps.example.com
```

Sau đó mở trình duyệt tại `http://127.0.0.1:20131/` và dán `ADMIN_TOKEN` vào ô mật khẩu.

### Định tuyến `/usage` trên Cloudflare Tunnel (khi muốn mở công khai)

Trên hostname API công khai (ví dụ `api.example.com`), thêm rule riêng cho `/usage` trỏ tới máy chủ công khai `http://127.0.0.1:20132` và giữ rule API suy luận/tra cứu không dùng catch-all:

- Path `^/usage(/assets/(usage\.css|usage\.js|format\.js))?$` → `http://127.0.0.1:20132`
- Path `^/(v1/(models|chat/completions|responses)|api/usage(/requests)?)$` → `http://127.0.0.1:20129` (hoặc trỏ cả hai sang `http://127.0.0.1:20132` vì `server-public.mjs` chỉ allowlist đúng các route này và luôn trả `404` cho `/admin*`, `/healthz`).

---

## 3. Kiểm thử tự động

Chạy toàn bộ kiểm thử backend và frontend:

```bash
npm test
```

Hoặc chỉ chạy kiểm thử frontend:

```bash
node --test test/frontend.test.mjs
```
