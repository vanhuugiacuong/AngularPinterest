# Hướng dẫn bật tính năng Billing (Pro + Credit + thanh toán QR)

Module: `src/billing`. Thanh toán bằng **VietQR** + đối soát tự động qua **webhook SePay**.

## 1. Cập nhật database (Prisma)

Đã thêm vào `prisma/schema.prisma`: field `User.isPro/proExpiresAt`, `Pin.isPremium/priceCredits/previewUrl/originalPath/isArchived`, và các model `Wallet`, `Subscription`, `Payment`, `PinEntitlement`, `CreditTransaction`.

Chạy trong thư mục `backend`:

```bash
npx prisma generate
npx prisma migrate dev --name add_billing
```

> Nếu chỉ muốn đẩy schema lên DB dev nhanh (không tạo file migration): `npx prisma db push`.
> **Bắt buộc chạy `prisma generate`** trước khi build — nếu không TypeScript sẽ báo thiếu
> `prisma.wallet`, `prisma.payment`... (client chưa có model mới).

## 2. Cấu hình biến môi trường (`.env`)

Xem `.env.example` (mục "Thương mại hoá"). Thêm:

```bash
BANK_BIN="970422"                 # mã ngân hàng Napas (MB Bank = 970422)
BANK_ACCOUNT_NO="số_tài_khoản_thật"
BANK_ACCOUNT_NAME="TEN CHU TK"    # không dấu
BANK_SHORT_NAME="MB Bank"
SEPAY_API_KEY="khoá_bí_mật_tự_đặt"
```

## 3. Nối webhook SePay (để tự nhận tiền)

1. Đăng ký https://sepay.vn → thêm tài khoản ngân hàng cần theo dõi (đúng `BANK_ACCOUNT_NO`).
2. Vào **Cấu hình → Webhooks**, tạo webhook:
   - URL: `https://<backend-domain>/api/billing/webhook/sepay`
   - Kiểu xác thực: **API Key** → đặt bằng đúng `SEPAY_API_KEY` ở trên
     (SePay sẽ gửi header `Authorization: Apikey <SEPAY_API_KEY>`).
3. Khi có người chuyển khoản đúng **nội dung CK** (memo `PINHUB...`) và **đủ số tiền**,
   SePay gọi webhook → backend đối chiếu → set `Payment = PAID` → cộng credit / kích hoạt Pro.
   Frontend đang polling `GET /api/billing/payments/:ref/status` sẽ tự nhận PAID.

> Chạy local muốn nhận webhook thật: dùng `ngrok http 3000` rồi lấy URL https đó điền vào SePay.
> Thay SePay bằng **PayOS/Casso** đều được — chỉ cần sửa `webhook/sepay` để verify chữ ký của
> cổng đó rồi gọi `billingService.settleIncomingTransfer(content, amount, ref)`.

## 4. Các endpoint (prefix `/api/billing`)

| Method | Route | Guard | Ghi chú |
|---|---|---|---|
| GET | `/plans` | — | Bảng giá + packs + bank |
| GET | `/me` | auth | isPro, proExpiresAt, số dư ví |
| GET | `/transactions` | auth | Lịch sử credit |
| POST | `/subscribe` | auth | `{plan}` → tạo đơn, trả `{ref, memo, amountVnd, qrUrl}` |
| POST | `/credits/purchase` | auth | `{packCode}` → tạo đơn QR |
| GET | `/payments/:ref/status` | auth | PENDING / PAID / EXPIRED |
| POST | `/payments/:ref/cancel` | auth | Hủy đơn đang chờ |
| POST | `/pins/:id/purchase` | auth | Trả credit mua quyền tải HD ảnh Premium |
| GET | `/pins/:id/access` | auth | owned/purchased/price |
| POST | `/webhook/sepay` | API key | Đối soát tiền vào tự động |

## 5. Frontend

`frontend/src/app/core/services/billing.ts` **ưu tiên gọi backend**, tự fallback về mô phỏng
localStorage khi backend chưa chạy (signal `online()` cho biết đang dùng bản nào). Không cần
sửa UI khi bật backend — chỉ cần backend chạy ở `http://localhost:3000` (hoặc cùng host:3000).

> Còn để mock (chưa nối backend): **chợ ảnh Premium** (đánh dấu Premium ở trang Tạo + mua/tải HD
> ở pin-detail) vẫn dùng registry localStorage, vì cần thêm cột premium ở API pins + private
> bucket/watermark (đặc tả §9). Endpoint `/pins/:id/purchase` và `/access` đã sẵn ở backend để nối.
