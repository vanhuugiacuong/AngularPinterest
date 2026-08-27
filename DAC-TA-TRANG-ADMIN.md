# Đặc tả trang Quản trị (Admin) — PinHub

> Trạng thái: **BẢN THẢO ĐỂ DUYỆT** — chưa code. Chốt xong mới làm.
> Nhánh dự kiến: `liem-admin` (tách riêng, không gộp vào PR đang mở).

### Đã chốt (28/08)
- Dùng cột **riêng** `isPinhubAdmin`, không đụng `isAdmin` của hệ khác — mục 3.1
- **Có** làm khoá tài khoản (thêm `isPinhubBanned`) — mục 4.2
- **Có** thêm trạng thái cho `PinReport` (`status` + `resolvedAt`) — mục 4.1
- Bổ sung khu vực **Rút tiền** (mục 4.5) và **Báo cáo thanh toán** (mục 4.1b)

---

## 1. Vì sao cần

Hiện người dùng đã báo cáo được ảnh vi phạm (`POST /pins/:id/report`, lưu vào bảng
`PinReport`), nhưng **không ai đọc được các báo cáo đó** — không có trang quản trị,
không có màn hình nào hiển thị. Báo cáo gửi xong nằm im trong DB.

Tương tự: đã bán gói Pro và credit (19 giao dịch `Payment`, 3 `Subscription` trong
DB thật) nhưng không có chỗ nào xem doanh thu ngoài việc query tay.

---

## 2. Hiện trạng dữ liệu (khảo sát DB thật, 27/08/2026)

| Bảng | Số bản ghi | Ghi chú |
|---|---:|---|
| `User` | 32 | **đã có sẵn cột `isAdmin`** (boolean, NOT NULL, default false) |
| `Pin` | 1069 | gồm ảnh seed Unsplash + ảnh user thật |
| `PinReport` | 0 | chưa ai báo cáo (tính năng vừa nối xong) |
| `Payment` | 19 | giao dịch QR đã tạo |
| `Subscription` | 3 | lượt mua Pro |
| `Wallet` | 6 | ví credit |
| `CreditTransaction` | 5 | lịch sử cộng/trừ credit |
| `PinEntitlement` | 0 | chưa ai mua ảnh Premium |
| `HiddenPin` | 2 | ảnh user tự ẩn khỏi feed của mình |

**Quan trọng:** cột `isAdmin` do hệ thống của bạn cùng nhóm tạo ra, **hiện có 1 admin**
là `sau3e_123` (ltt814804@gmail.com). Chưa có dòng code nào trong repo này dùng tới nó.

---

## 3. Phân quyền

### 3.1 Cách xác định admin — dùng cột RIÊNG

Cột `User.isAdmin` **đã tồn tại trong DB nhưng KHÔNG PHẢI của hệ thống này** — nó
thuộc một hệ thống khác đang dùng chung database (tài khoản `sau3e_123` /
ltt814804@gmail.com đang bật cờ đó, không phải người của nhóm).

Đây đúng là tình huống đã gặp khi làm thanh toán: enum `PaymentStatus` bị trùng
với hệ khác nên phải đổi thành `QrPaymentStatus`. Lần này cũng vậy.

**→ Dùng cột riêng `isPinhubAdmin`, KHÔNG đụng vào `isAdmin`.**

```sql
-- additive-only, an toàn, không phá gì của hệ khác
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isPinhubAdmin" BOOLEAN NOT NULL DEFAULT false;
```

```prisma
model User {
  // ...
  isPinhubAdmin Boolean @default(false)   // quyền admin RIÊNG của PinHub (hệ này)
  // KHÔNG khai báo isAdmin — cột đó của hệ thống khác dùng chung DB
}
```

Cấp quyền:
```sql
UPDATE "User" SET "isPinhubAdmin" = true WHERE email = 'email-cua-ban@gmail.com';
```

### 3.2 Vì sao không dùng chung

| Nếu dùng chung `isAdmin` | Hậu quả |
|---|---|
| Admin hệ khác | tự động vào được trang admin PinHub, xem doanh thu, gỡ ảnh |
| Họ cấp/thu quyền bên phía họ | quyền trang admin PinHub đổi theo mà mình không biết |
| Mình cấp quyền cho ai đó | người đó có thể vào được cả trang admin của hệ kia |

Tách cột riêng thì hai hệ độc lập hoàn toàn, không ảnh hưởng nhau.

### 3.3 Chặn ở backend

Tạo `AdminGuard` (kế thừa sau `SupabaseAuthGuard`): đọc `isAdmin` từ DB theo
`user.id`, không tin dữ liệu từ client. Mọi endpoint admin đều gắn guard này.
Frontend chỉ là lớp che giao diện, **không phải lớp bảo mật**.

---

## 4. Phạm vi — 4 khu vực

### 4.1 Báo cáo vi phạm (ưu tiên cao nhất — lý do sinh ra trang này)

**Màn hình:** danh sách ảnh bị báo cáo, gom nhóm theo ảnh (1 ảnh bị 5 người báo
cáo = 1 dòng, hiện số lượt), sắp xếp theo số lượt giảm dần.

| Cột | Nội dung |
|---|---|
| Ảnh | thumbnail + tiêu đề, bấm mở chi tiết |
| Tác giả | username + huy hiệu Pro |
| Số lượt báo cáo | ví dụ `5 lượt` |
| Lý do | các lý do đã gộp (vd "Spam ×3, Bạo lực ×2") |
| Mới nhất | thời điểm báo cáo gần nhất |
| Hành động | `Gỡ ảnh` / `Bỏ qua` / `Xem chi tiết` |

**Chi tiết một ảnh:** liệt kê từng báo cáo (người báo cáo, lý do đầy đủ kèm mô tả
tự nhập, thời gian).

**Hành động:**
- `Gỡ ảnh` — xoá pin (đã có `deletePin`), ghi log, các báo cáo liên quan tự mất theo
  (`onDelete: Cascade`).
- `Bỏ qua` — đánh dấu đã xử lý, ẩn khỏi danh sách chờ.

> **Thiếu sót cần bổ sung:** bảng `PinReport` hiện **không có cột trạng thái**
> (`status`/`resolvedAt`), nên không phân biệt được báo cáo đã xử lý hay chưa.
> Cần thêm cột — xem mục 6.

### 4.2 Người dùng

**Màn hình:** bảng danh sách user (32 người), tìm theo username/email.

| Cột | Nội dung |
|---|---|
| Người dùng | avatar + username + email |
| Pro | còn hạn / hết hạn / chưa mua + ngày hết hạn |
| Số ảnh | đếm pin đã đăng |
| Credit | số dư ví |
| Tham gia | ngày tạo tài khoản |
| Hành động | `Xem hồ sơ` / `Cấp Pro thủ công` |

**Cân nhắc — chưa chốt:** chức năng **khoá tài khoản** hiện **chưa có cột nào hỗ trợ**
(không có `isBanned`/`bannedAt`). Muốn làm phải thêm cột vào bảng chung.
→ **Cần bạn quyết:** làm khoá tài khoản (thêm cột) hay tạm bỏ qua?

### 4.3 Doanh thu & giao dịch

**Thẻ tổng quan (6 ô):**
- Tổng doanh thu (VNĐ) — cộng `Payment` đã `PAID`
- Doanh thu tháng này
- Số thành viên Pro đang còn hạn
- Số giao dịch chờ thanh toán
- **Tổng credit đang lưu hành** — cộng `Wallet.spendable` của toàn hệ thống
- **Tổng credit người bán đã kiếm** — cộng `Wallet.earnings`

**Bảng credit theo người dùng:** username, credit khả dụng, credit đã kiếm,
trạng thái Pro — sắp xếp theo số dư giảm dần. Giúp phát hiện tài khoản có số dư
bất thường.

> Credit là "tiền trong hệ thống" — tổng credit lưu hành cho biết nghĩa vụ chưa
> thanh toán của nền tảng (người dùng còn bao nhiêu credit chưa tiêu).

**Bảng giao dịch:** thời gian, người mua, loại (gói Pro / gói credit), số tiền,
trạng thái (PAID/PENDING/EXPIRED), mã tham chiếu (`txnRef`).

**Biểu đồ:** doanh thu theo ngày trong 30 ngày gần nhất.

> Dữ liệu lấy từ `Payment` + `Subscription` — **chỉ đọc**, không sửa. Việc đối soát
> tiền đã có SePay tự động, admin không nên sửa tay để tránh sai lệch sổ sách.

### 4.4 Nội dung / ảnh

**Màn hình:** lưới ảnh toàn hệ thống (1069 ảnh), lọc theo:
- Tất cả / Ảnh Premium đang bán / Ảnh AI tạo / Ảnh seed hệ thống (tài khoản `unsplash`)
- Tìm theo tiêu đề

**Hành động:** `Xem` / `Gỡ ảnh`.

**Thẻ tổng quan:** tổng số ảnh, số ảnh Premium, số ảnh AI, số ảnh seed.

### 4.5 Rút tiền (payout) — khu vực nhạy cảm nhất

Người bán ảnh tích được credit trong `Wallet.earnings`, gửi yêu cầu rút, admin
duyệt rồi **chuyển khoản tay** qua ngân hàng. Không tự động chuyển tiền.

#### Chỉ được rút `earnings`, KHÔNG rút `spendable`

Đây là ràng buộc quan trọng nhất, phải chặn ở backend:

| Loại credit | Nguồn | Rút được? |
|---|---|---|
| `earnings` | bán ảnh Premium cho người khác | ✅ có |
| `spendable` | **người dùng bỏ tiền mua** hoặc được tặng kèm Pro | ❌ không |

Nếu cho rút `spendable`, người ta có thể **nạp tiền vào rồi rút ra** — nền tảng
biến thành nơi chuyển tiền hộ, vừa lỗ phí thanh toán vừa rủi ro pháp lý. Chỉ
tiền do người khác trả cho họ mới được rút.

#### Luồng

```
Người dùng                     Admin
    │                            │
    ├─ Gửi yêu cầu rút           │
    │  (số credit + STK + tên)   │
    │  → earnings bị GIỮ ngay    │
    │                            │
    │                        ┌───┴───┐
    │                    Duyệt    Từ chối
    │                        │        │
    │                   Chuyển khoản  └→ hoàn earnings về ví
    │                    tay qua bank      + ghi lý do
    │                        │
    │                   Đánh dấu "Đã chuyển"
    │                    (nhập mã GD ngân hàng)
    │◄── nhận thông báo ─────┘
```

**Giữ credit ngay khi gửi yêu cầu** (trừ `earnings`, ghi `CreditTransaction`),
không đợi duyệt. Nếu đợi thì người dùng có thể gửi 5 yêu cầu cùng lúc cho cùng
một số dư, admin duyệt hết là mất tiền thật.

#### Màn hình admin

| Cột | Nội dung |
|---|---|
| Người gửi | avatar + username + tổng đã rút trước đó |
| Số credit | số credit rút |
| Thành tiền | quy đổi ra VNĐ theo tỷ giá |
| Ngân hàng | tên NH + số TK + tên chủ TK (có nút sao chép) |
| Gửi lúc | thời gian |
| Trạng thái | Chờ duyệt / Đã duyệt / Đã chuyển / Từ chối |
| Hành động | `Duyệt` · `Từ chối` (bắt nhập lý do) · `Đánh dấu đã chuyển` |

Ô nhập **mã giao dịch ngân hàng** khi đánh dấu đã chuyển, để đối chiếu sau này.

#### Màn hình người dùng (trong Ví)

- Nút **"Rút tiền"** hiện khi `earnings` ≥ ngưỡng tối thiểu
- Form: số credit muốn rút, ngân hàng, số tài khoản, tên chủ tài khoản
- Lịch sử các lần rút + trạng thái từng lần
- Nếu bị từ chối: hiện lý do admin ghi

#### Bảng mới `PayoutRequest`

Không dùng các cột `payoutBankCode` / `payoutAccountNumber` / `payoutAccountName`
đã có sẵn trong `User` — **đó là của hệ thống khác** dùng chung DB.

```sql
CREATE TABLE IF NOT EXISTS "PayoutRequest" (
  "id"            TEXT PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "credits"       INTEGER NOT NULL,      -- số credit rút
  "amountVnd"     INTEGER NOT NULL,      -- quy đổi tại thời điểm gửi (khoá tỷ giá)
  "bankName"      TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountName"   TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|APPROVED|PAID|REJECTED
  "rejectReason"  TEXT,
  "bankRef"       TEXT,                  -- mã GD ngân hàng khi đã chuyển
  "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"   TIMESTAMP
);
```

`amountVnd` **khoá lại tại thời điểm gửi** — nếu sau này đổi tỷ giá thì yêu cầu
cũ vẫn giữ đúng số tiền đã hứa với người dùng.

#### Ràng buộc bắt buộc (backend)

1. `credits` ≤ `wallet.earnings` hiện có
2. `credits` ≥ ngưỡng tối thiểu
3. Mỗi người **chỉ có 1 yêu cầu đang chờ** tại một thời điểm
4. Trừ `earnings` trong cùng transaction với việc tạo yêu cầu
5. Từ chối → hoàn `earnings` + ghi `CreditTransaction` kiểu `REFUND`
6. Thông tin ngân hàng **chỉ admin đọc được**, không trả về API công khai,
   không ghi vào log

#### Đã chốt & đã code (phía người dùng)

- **Tỷ giá: 150đ / credit** (giá bán ~183đ, chênh ~18% bù phí chuyển khoản)
- **Tối thiểu: 500 credit** (≈ 75.000đ) — đủ lớn để không phải chuyển khoản lặt vặt

Đã xong phần người dùng:
- `PayoutRequest` (bảng), `PAYOUT_VND_PER_CREDIT`, `PAYOUT_MIN_CREDITS` (config)
- `GET /billing/payout` · `POST /billing/payout` · `POST /billing/payout/:id/cancel`
- Khu vực "Rút tiền về ngân hàng" trong trang Ví: form, xác nhận, lịch sử, huỷ

**Còn lại (phần admin):** màn duyệt yêu cầu — `Duyệt` / `Từ chối` (nhập lý do) /
`Đánh dấu đã chuyển` (nhập mã GD ngân hàng).

---

## 5. Thiết kế giao diện

Tuân thủ hệ thiết kế hiện có (đã đồng bộ ở PR #53):

- Dark-only, nền `#0f0d13`, thẻ `#17131c` / dialog `#1b1622`
- Màu chính hồng, dùng token chung `--grad-brand` (gradient 4 dải)
- Dialog: scrim `black/60` + `blur-md` + `z-[80]`, riêng ConfirmDialog `z-[90]`
- Toast dùng `ToastService` sẵn có; xác nhận nguy hiểm dùng `ConfirmService`
- Bố cục: sidebar trái (4 mục) + vùng nội dung, **tách khỏi navbar người dùng thường**

**Đường dẫn:** `/admin`, `/admin/reports`, `/admin/users`, `/admin/revenue`, `/admin/content`

Vào `/admin` khi không phải admin → chuyển về `/feed` (guard phía route + guard phía API).

---

## 6. Thay đổi CSDL cần thiết

Nguyên tắc bất di bất dịch: **additive-only, SQL thủ công, KHÔNG `prisma db push`**
(sẽ xoá bảng của nhóm).

| Việc | Kiểu | Bắt buộc? |
|---|---|---|
| Thêm `User.isPinhubAdmin` | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | ✅ bắt buộc (cột riêng, xem 3.1) |
| Thêm `PinReport.status` + `PinReport.resolvedAt` | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | ✅ nếu muốn phân biệt đã/chưa xử lý |
| Thêm `User.isPinhubBanned` | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | ⬜ chỉ khi bạn muốn khoá tài khoản |

> Mọi cột mới đều mang tiền tố `Pinhub` để **không bao giờ đụng tên** với hệ thống
> khác đang dùng chung DB — cùng nguyên tắc đã áp dụng cho `QrPaymentStatus`.

Script đặt tại `backend/scratch/apply-admin.sql` + `apply-admin.cjs`, chạy tay,
in số bản ghi bảng cũ trước/sau để chứng minh không phá gì (giống `apply-billing.cjs`).

---

## 7. API dự kiến

Tất cả gắn `SupabaseAuthGuard` + `AdminGuard`:

```
GET    /api/admin/stats                 → số liệu tổng quan 4 khu vực
GET    /api/admin/reports               → danh sách báo cáo (gom theo pin, phân trang)
GET    /api/admin/reports/:pinId        → chi tiết các báo cáo của 1 ảnh
POST   /api/admin/reports/:pinId/resolve→ bỏ qua (đánh dấu đã xử lý)
DELETE /api/admin/pins/:id              → gỡ ảnh vi phạm
GET    /api/admin/users                 → danh sách user (tìm kiếm, phân trang)
POST   /api/admin/users/:id/grant-pro   → cấp Pro thủ công
GET    /api/admin/payments              → lịch sử giao dịch (lọc theo trạng thái)
GET    /api/admin/revenue/daily         → doanh thu 30 ngày cho biểu đồ
GET    /api/admin/pins                  → danh sách ảnh (lọc premium/ai/seed)
```

---

## 8. Rủi ro & cách phòng

| Rủi ro | Phòng |
|---|---|
| Người thường tự gọi API admin | `AdminGuard` đọc `isPinhubAdmin` từ DB mỗi request, không tin client |
| Gỡ nhầm ảnh (không hoàn tác được) | Bắt buộc xác nhận qua `ConfirmService`, nêu rõ tên ảnh + tác giả |
| Đụng dữ liệu hệ khác dùng chung DB | Chỉ ADD COLUMN tên có tiền tố `Pinhub`, không sửa/xoá cột cũ; script in số liệu trước/sau |
| Admin hệ khác vào được trang này | Đã xử lý: dùng cột riêng `isPinhubAdmin`, không đụng `isAdmin` (mục 3.1) |
| Trang doanh thu bị sửa tay gây lệch sổ | Khu vực doanh thu **chỉ đọc**, không có nút sửa |

---

## 9. Thứ tự làm (đề xuất)

1. `AdminGuard` + khai báo `isAdmin` vào schema + route `/admin` có bảo vệ
2. **Báo cáo vi phạm** (lý do chính sinh ra trang này)
3. Người dùng
4. Doanh thu
5. Nội dung / ảnh

Làm xong mục 1+2 là đã dùng được thật; 3–5 bổ sung dần.

---

## 10. Cần bạn chốt trước khi code

1. ~~Dùng chung `isAdmin`~~ → **đã chốt: dùng cột riêng `isPinhubAdmin`** (mục 3.1)
2. **Khoá tài khoản người dùng** — có làm không (phải thêm cột `isPinhubBanned`)?
3. **Thêm cột trạng thái cho `PinReport`** — đồng ý không? (không có thì mỗi lần vào
   đều thấy lại báo cáo đã xử lý)
4. Còn khu vực nào bạn muốn thêm/bớt không?
