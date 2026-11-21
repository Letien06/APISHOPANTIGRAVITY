# Gateway API cho 9Router

Backend chạy trên VPS cùng 9Router. Admin tạo key có hạn mức, hạn dùng và quyền model riêng. Gateway xác thực key, chuyển request bằng key nội bộ của 9Router và lưu số lượt gọi cùng chi phí đầu vào và đầu ra. 9Router quản lý kết nối Antigravity qua Google OAuth.

```text
Client → Cloudflare Tunnel → Gateway :20129 → 9Router :20128 → Antigravity
Admin  → SSH → Gateway :20129 và dashboard 9Router :20128
```

Prompt UI/UX và tiêu chí bàn giao frontend nằm trong [PROMPT-ANTIGRAVITY.md](PROMPT-ANTIGRAVITY.md).

## Triển khai trên VPS Linux

Khi đã upload gói `9router-gateway.tar.gz`, giải nén vào `/opt/9router-gateway` rồi chạy `bash /opt/9router-gateway/deploy/install-vps.sh`. Trình cài đọc danh sách model qua 9Router, dùng giá thử nghiệm từ `models.example.json` và kiểm tra `/healthz` sau khi khởi động. Các bước bên dưới dành cho cấu hình thủ công hoặc điều chỉnh giá trước khi phát key.

1. Giữ 9Router đang chạy và truy cập được từ VPS tại `http://127.0.0.1:20128`. Dùng SSH port forwarding để mở dashboard 9Router. Kết nối Google trong **Providers → Antigravity**, bật **Require API key** và tạo một key nội bộ dành riêng cho gateway. Kiểm tra model bằng một yêu cầu thực tế trong 9Router trước khi cấp key. [Triển khai 9Router](https://github.com/decolua/9router#-deployment) · [Google OAuth trong 9Router](https://github.com/decolua/9router/blob/master/src/shared/components/OAuthModal.js)
2. Sao chép project lên VPS. Tạo `.env` từ `.env.example` và `models.json` từ `models.example.json`.

   ```bash
   cp .env.example .env
   chmod 600 .env
   cp models.example.json models.json
   ```

   Điền `ROUTER_API_KEY` bằng key nội bộ vừa tạo và `ADMIN_TOKEN` bằng một giá trị ngẫu nhiên riêng. Dùng `openssl rand -hex 32` để tạo token quản trị. Thay ID và giá trong `models.json` bằng model đã kiểm tra trên VPS và mức giá nội bộ do bạn đặt. Nếu đổi đường dẫn có ký tự `#`, đặt giá trị trong dấu nháy đơn trong `.env`.

3. Chạy backend và kiểm tra origin nội bộ.

   ```bash
   docker compose up -d --build
   curl -fsS http://127.0.0.1:20129/healthz
   ```

   Compose dùng mạng host trên Linux để gateway gọi được cổng loopback của 9Router. SQLite nằm trong volume `gateway-data` và vẫn được giữ khi thay container. Khi chạy trực tiếp bằng Node.js 24 trở lên, dùng `npm start` và dữ liệu mặc định nằm trong `./data/`. Backend dùng các thư viện có sẵn của Node.js. Để sao lưu nhất quán, dừng riêng gateway, sao lưu volume hoặc toàn bộ thư mục dữ liệu, rồi khởi động gateway trở lại. Nếu tăng `UPSTREAM_TIMEOUT_MS`, tăng `stop_grace_period` trong Compose để các request đang chạy có đủ thời gian kết thúc.

4. Trên Tunnel đang dùng, trỏ hostname API về `http://127.0.0.1:20129` nếu `cloudflared` chạy trực tiếp trên VPS. Mẫu [cloudflared.example.yml](deploy/cloudflared.example.yml) dành cho Tunnel quản lý bằng file. Với Tunnel quản lý từ Cloudflare, cấu hình cùng giới hạn đường dẫn trong Published Application Routes. Giữ các route public chỉ mở ba endpoint suy luận và hai endpoint tra cứu bên dưới. Kiểm tra các route cùng hostname hoặc wildcard trước khi đóng route public cũ trỏ thẳng đến 9Router. [Cloudflare ingress](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/)
5. Từ ngoài VPS, kiểm tra các endpoint hợp lệ với hai key độc lập. Thử thiếu key, sai key, key hết hạn và hết quota. Đường dẫn `/admin/v1/keys`, `/healthz` và `/dashboard` phải bị chặn trên hostname public. UI sau này sẽ bổ sung route frontend `/usage` và asset riêng từ origin frontend. Các route API giữ nguyên.

## API công khai

Tất cả yêu cầu dùng `Authorization: Bearer <gw_key>`. Base URL của client là `https://api.tenmien.com/v1`.

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| `GET` | `/v1/models` | Danh sách model trong cấu hình mà key được phép gọi |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions, có JSON và SSE |
| `POST` | `/v1/responses` | OpenAI Responses, có JSON và SSE nếu bản 9Router hỗ trợ model đã chọn |
| `GET` | `/api/usage` | Hạn mức, đã dùng, đang giữ chỗ, còn lại, hạn dùng và số request của key |
| `GET` | `/api/usage/requests?limit=25&before=123` | Lịch sử chính key đó, mới nhất trước, trả `{ items, nextCursor }` |

`before` để trống ở trang đầu. Dùng `nextCursor` cho trang sau và dừng tại `null`. Key đã hết hạn hoặc hết quota vẫn xem được usage. Key bị vô hiệu hóa bị từ chối ở cả API suy luận và API tra cứu. Mã lỗi thường dùng gồm `401 invalid_key`, `401 key_expired`, `401 key_disabled`, `403 model_forbidden` và `429 quota_exceeded`.

## API quản trị riêng

Truy cập qua SSH local forwarding, ví dụ `ssh -N -L 20129:127.0.0.1:20129 user@VPS`. Gọi `http://127.0.0.1:20129` bằng `Authorization: Bearer <ADMIN_TOKEN>`.

| Phương thức | Đường dẫn |
|---|---|
| `GET` | `/admin/v1/models` |
| `GET`, `POST` | `/admin/v1/keys` |
| `GET`, `PATCH`, `DELETE` | `/admin/v1/keys/:id` |
| `GET` | `/admin/v1/keys/:id/requests?limit=25` |

Ví dụ body cho `POST /admin/v1/keys`, với `Content-Type: application/json`.

```json
{
  "name": "Bạn A",
  "quotaMicros": 5000000,
  "expiresAt": "2026-12-01T17:00:00.000Z",
  "models": ["ag/gemini-2.5-flash"]
}
```

`expiresAt: null` đặt key không có hạn dùng. `models: null` cấp mọi model trong cấu hình và `models: []` không cấp model nào. Giá trị `expiresAt` dùng ISO UTC với hậu tố `Z`. API chỉ trả key đầy đủ tại lần tạo. `PATCH` sửa trường `name`, `quotaMicros`, `expiresAt`, `models` hoặc `enabled`. Giảm quota thấp hơn số đã dùng cộng với số đang giữ chỗ trả `409 quota_below_usage`. `DELETE` vô hiệu hóa và giữ lịch sử. Sau sự cố lộ key, giữ key cũ ở trạng thái vô hiệu hóa và cấp key mới.

## Hạn mức và chi phí

- `quotaMicros` là ngân sách nội bộ. Nếu dùng USD, 1 USD bằng 1.000.000 micros. Giá đầu vào và đầu ra khai báo riêng theo mỗi triệu token ở `models.json`. Mỗi phần chi phí được làm tròn lên tới một micro. Giá này phục vụ chia quota và đối soát trong nhóm.
- Trước mỗi lượt gửi đến 9Router, gateway giữ chỗ dựa trên `maxInputTokens` và giới hạn đầu ra của request. Nếu request bỏ giới hạn đầu ra, gateway đặt `maxOutputTokens` từ cấu hình. Chat dùng `max_tokens` mặc định hoặc `max_completion_tokens` nếu đặt `chatOutputLimitField` cho model. Khi hai request chạy song song, cả hai dùng chung ngân sách đã ghi trong một giao dịch SQLite. Chọn `maxInputTokens` phù hợp với giới hạn upstream để giữ chỗ sát với khoản có thể phát sinh.
- `requestCount` đếm lượt gateway chấp nhận gửi sang 9Router, gồm lỗi kết nối và lỗi upstream. Tra cứu, gọi danh sách model và yêu cầu bị chặn trước khi chuyển tiếp không làm tăng bộ đếm. Gateway thực hiện một lượt gửi cho mỗi request được chấp nhận.
- Khi 9Router trả usage, gateway lưu `inputTokens`, `outputTokens`, `inputCostMicros`, `outputCostMicros` và `chargedMicros`. Nếu chi phí quan sát vượt khoản đã giữ, quota của key chỉ bị trừ tới khoản giữ chỗ. Lịch sử vẫn hiện cả chi phí quan sát và khoản đã trừ.
- Lỗi upstream xác nhận được và thiếu usage không bị trừ quota. Trường hợp kết nối lỗi chưa rõ kết quả, quá hạn hoặc phản hồi thành công thiếu usage dùng khoản giữ chỗ để quyết toán và đánh dấu `estimated: true`. Token thật khi đó để `null`. Một tiến trình bị dừng giữa lượt gọi sẽ tự quyết toán phần giữ chỗ nếu quá thời hạn khi khởi động lại hoặc khi có lần đọc dữ liệu mới.
- Gateway lưu hash của key, tiền tố hiển thị và metadata usage trong SQLite. Giữ `.env`, dữ liệu và bản sao lưu ở vùng riêng của VPS. Với hostname public, giữ `Cache-Control: no-store` cho API tra cứu.

## Kiểm thử

Chạy `npm test` với Node.js 24 trở lên. Các bài kiểm thử HTTP sử dụng 9Router giả lập trên loopback, gồm xác thực, hết hạn, quota song song, thu hồi, lịch sử tách theo key, phí input/output, dữ liệu usage từ SSE và phục hồi SQLite sau khi khởi động lại. Sau khi cấu hình VPS, thử thêm model `ag/...` thật bằng cả JSON và SSE để xác nhận bản 9Router thực tế trả token usage.
