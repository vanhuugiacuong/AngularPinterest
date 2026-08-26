# Đặc tả tính năng: Thương mại hoá (Pro + Credit) cho pinthub

> Tài liệu đặc tả cho tính năng **mới hoàn toàn** — hiện pinthub chưa có bất kỳ khái niệm tiền tệ / thanh toán nào.
> Phiên bản: 1.0 · Ngày: 2026-08-26 · Trạng thái: Draft để review.

---

## 1. Tổng quan & mục tiêu

pinthub là một Pinterest clone có sẵn tính năng **AI generation** (text-to-image qua Pollinations) — thứ tốn tài nguyên thật, nên đây là điểm kiếm tiền tự nhiên. Tính năng thương mại gồm **2 trụ cột kết hợp**:

1. **Gói Pro (subscription, trả phí định kỳ)** — mở khoá AI không giới hạn + model xịn, tải HD/không watermark cho ảnh của mình và ảnh miễn phí, huy hiệu Pro. **Mỗi kỳ Pro còn được tặng kèm một lượng credit** để tải ảnh đẹp của người khác.
2. **Credit (token) + chợ ảnh premium** — người đăng pin có thể **đánh dấu ảnh là Premium** và **tự đặt giá bằng credit**; người khác muốn tải **bản HD sạch** phải **trả credit**, creator được chia doanh thu. Credit mua thêm bằng tiền thật (VND) qua VNPay.

**Yêu cầu bảo mật trọng tâm:** bản HD sạch (không watermark) của ảnh Premium **không được lộ qua DevTools/F12** (network, right-click, xem source). Chỉ ảnh preview có watermark mới xuất hiện công khai. Xem [§9](#9-cơ-chế-bảo-vệ-ảnh-premium-chống-f12).

### Quyết định đã chốt

| Hạng mục | Lựa chọn |
|---|---|
| Mô hình | **Pro (subscription) + Credit AI/marketplace** (kết hợp) |
| Đơn vị tiền tệ | **VND** (Việt Nam Đồng) |
| Cổng thanh toán | **VNPay** (sandbox cho demo/đồ án; production khi có MID thật) |
| Quyền lợi Pro lõi | AI gen không giới hạn + model xịn · Tải HD/không watermark · Credit tặng hàng tháng |
| Chợ ảnh | Creator tự đặt giá credit cho ảnh Premium, người khác trả credit để tải HD |

---

## 2. Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| **Free** | Tài khoản mặc định, không trả phí. Bị giới hạn quota AI, tải ảnh Premium phải trả credit. |
| **Pro** | Tài khoản đang có subscription hiệu lực (`proExpiresAt > now`). |
| **Credit (token)** | Đơn vị nội bộ để tải ảnh Premium (và tuỳ chọn: vượt quota AI). Không phải tiền, nhưng mua bằng VND. |
| **Credit tặng (grant)** | Credit đi kèm gói Pro mỗi kỳ, **hết hạn cuối kỳ** (use-it-or-lose-it). |
| **Credit mua (purchased)** | Credit mua lẻ qua pack, **không hết hạn**. |
| **Credit thu nhập (earnings)** | Credit creator nhận được khi bán ảnh Premium; tách khỏi ví chi tiêu. |
| **Premium Pin** | Pin do người dùng đánh dấu bán; có **bản preview watermark (công khai)** và **bản HD gốc (riêng tư)**. |
| **Entitlement (quyền tải)** | Bản ghi xác nhận một user đã trả credit và có quyền tải HD một pin — **vĩnh viễn**. |
| **Preview** | Bản ảnh downscale + watermark hiện rõ, phục vụ công khai qua CDN. |
| **Original HD** | Bản gốc chất lượng cao, không watermark, lưu bucket **private**, chỉ giao cho người có entitlement. |

---

## 3. Mô hình kinh doanh & bảng giá

> Các con số dưới là **đề xuất**, chỉnh được ở bảng cấu hình. Hiển thị dạng `79.000₫`.

### 3.1. Gói Pro

| Gói | Giá | Credit tặng/kỳ | Ghi chú |
|---|---|---|---|
| Pro tháng | **79.000₫ / tháng** | 300 credit | Reset đầu mỗi kỳ |
| Pro năm | **790.000₫ / năm** | 300 credit/tháng | Tiết kiệm ~17% (tặng 2 tháng) |

**Quyền lợi Pro:**
- AI generation **không giới hạn** (soft cap chống lạm dụng: 200 lượt/ngày), **model cao cấp**, kích thước lớn, **không phải xếp hàng**.
- **Tải HD, không watermark** cho: ảnh do chính mình tạo/đăng, và mọi ảnh **miễn phí** (không Premium) của người khác.
- Được **300 credit/tháng** để tải ảnh Premium của người khác.
- **Board bí mật không giới hạn**, **huy hiệu Pro** trên hồ sơ/avatar, ẩn quảng cáo (nếu có).

> Lưu ý: Pro **không** cho tải miễn phí ảnh **Premium của người khác** — vẫn phải trả credit (nhưng dùng credit tặng hàng tháng).

### 3.2. Gói Credit (mua lẻ, không hết hạn)

| Pack | Credit | Giá | Quy đổi tham chiếu |
|---|---|---|---|
| S | 100 | 20.000₫ | ~200₫/credit |
| M | 300 | 55.000₫ | ~183₫/credit |
| L | 700 | 120.000₫ | ~171₫/credit |
| XL | 1.500 | 240.000₫ | ~160₫/credit |

### 3.3. Giá ảnh Premium & chia doanh thu

- Creator đặt giá mỗi ảnh Premium trong khoảng **10–500 credit** (bội số 5).
- Khi bán được: **creator nhận 70%**, **nền tảng giữ 30%** (cấu hình `PLATFORM_FEE_PERCENT`).
- Credit thu nhập của creator vào **ví thu nhập**; có thể dùng để mua ảnh khác. (Rút ra tiền mặt: **ngoài phạm vi** bản này — đề xuất giai đoạn sau, admin duyệt.)

### 3.4. Giới hạn Free vs Pro

| Hạng mục | Free | Pro |
|---|---|---|
| AI generation | 10 lượt/ngày, model cơ bản, có hàng đợi | Không giới hạn (soft cap 200/ngày), model cao cấp |
| Kích thước ảnh AI | ≤ 1024px | ≤ 2048px |
| Tải ảnh **miễn phí** của người khác | Bản thường (≤ preview) | **HD, không watermark** |
| Tải ảnh **Premium** của người khác | Trả credit | Trả credit (có 300 credit tặng/tháng) |
| Credit tặng | 0 | 300/kỳ |
| Board bí mật | Tối đa 3 | Không giới hạn |
| Huy hiệu Pro | Không | Có |

---

## 4. Đối tượng & phân quyền

| Actor | Mô tả |
|---|---|
| **Khách (chưa đăng nhập)** | Xem feed (preview watermark cho pin Premium), không mua/không tải HD. |
| **User Free** | Tạo/đăng pin, đặt pin Premium để bán, mua credit, mua Pro, trả credit để tải HD ảnh người khác. |
| **User Pro** | Như Free + quyền lợi Pro (§3.1). |
| **Creator** | Bất kỳ user nào đăng pin Premium; xem thu nhập credit. |
| **Admin** | Xem đơn thanh toán, doanh thu, cấu hình giá, xử lý khiếu nại/refund, kiểm duyệt ảnh Premium. |

Phân quyền kỹ thuật: dùng lại `SupabaseAuthGuard` + `@CurrentUser()` sẵn có. Thêm `ProGuard` (chặn quyền lợi Pro) và kiểm tra entitlement/ownership ở tầng service.

---

## 5. Bảng đặc tả chức năng (Functional Requirements)

Ưu tiên: **P0** (bắt buộc MVP) · **P1** (nên có) · **P2** (mở rộng).

| Mã | Nhóm | Chức năng | Actor | Mô tả & quy tắc nghiệp vụ | Ưu tiên |
|---|---|---|---|---|---|
| FR-01 | Pro | Xem bảng giá Pro | Tất cả | Trang "Nâng cấp Pro" hiển thị 2 gói + quyền lợi + giá VND. | P0 |
| FR-02 | Pro | Mua/gia hạn Pro | User | Chọn gói → tạo `Payment` PENDING → redirect VNPay. Thanh toán thành công → kích hoạt Pro, cộng credit tặng, tạo `Subscription`. | P0 |
| FR-03 | Pro | Trạng thái Pro | User | Hiển thị còn hạn tới ngày nào; huy hiệu Pro. | P0 |
| FR-04 | Pro | Hết hạn Pro | Hệ thống | Khi `proExpiresAt < now`: tự hạ về Free, credit tặng chưa dùng hết hạn. Không thu tiền tự động (không auto-renew ở MVP). | P0 |
| FR-05 | Credit | Xem ví credit | User | Hiển thị số dư **credit chi tiêu** (grant + mua) và **credit thu nhập**, kèm hạn của credit tặng. | P0 |
| FR-06 | Credit | Mua credit pack | User | Chọn pack → `Payment` PENDING → VNPay → thành công cộng credit (không hết hạn). | P0 |
| FR-07 | Credit | Lịch sử giao dịch ví | User | Danh sách `CreditTransaction` (nạp, tiêu, nhận bán, tặng, hết hạn, refund) kèm số dư sau. | P1 |
| FR-08 | Premium | Đăng pin dạng Premium | Creator | Khi upload/lưu pin, bật cờ **Premium** + nhập **giá credit** (10–500, bội số 5). Hệ thống tạo **preview watermark (public)** + lưu **HD gốc (private)**. | P0 |
| FR-09 | Premium | Sửa giá / bật-tắt Premium | Creator | Chỉ chủ pin. Đổi giá **không** ảnh hưởng người đã mua. Tắt Premium → ảnh thành miễn phí (public HD). | P1 |
| FR-10 | Premium | Xem pin Premium (chưa mua) | Tất cả | Chỉ thấy **preview watermark**; nút "Tải HD – {giá} credit". Không có URL HD trong DOM/network. | P0 |
| FR-11 | Premium | Mua quyền tải (trả credit) | User | Trừ credit người mua, cộng 70% cho creator + 30% nền tảng, tạo **Entitlement vĩnh viễn**. Idempotent nếu đã sở hữu. | P0 |
| FR-12 | Premium | Tải HD sau khi mua | User có entitlement / chủ pin / Pro (với ảnh free) | Backend kiểm quyền → giao HD qua endpoint có kiểm soát (signed 1 lần, hết hạn nhanh), đính watermark ẩn (buyerId). | P0 |
| FR-13 | Premium | Không mua ảnh của chính mình | Hệ thống | Chặn creator trả credit cho pin của mình (đã sở hữu sẵn). | P0 |
| FR-14 | Premium | Không đủ credit | User | Chặn mua, hiện gợi ý "Mua thêm credit" / "Nâng cấp Pro". | P0 |
| FR-15 | Creator | Xem thu nhập | Creator | Tổng credit thu nhập, danh sách ảnh đã bán, số lượt bán. | P1 |
| FR-16 | AI | Kiểm soát quota AI | Hệ thống | Free 10 lượt/ngày (reset 00:00 giờ VN). Pro không giới hạn (soft cap). Trả về số lượt còn lại. | P0 |
| FR-17 | AI | Vượt quota bằng credit | User Free | (Tuỳ chọn) Free hết lượt có thể trả **5 credit/lượt** để tạo thêm. | P2 |
| FR-18 | Payment | VNPay Return (redirect) | User | Trang kết quả sau khi user quay lại từ VNPay: hiển thị thành công/thất bại (chỉ để hiển thị, **không** dùng để cộng tiền). | P0 |
| FR-19 | Payment | VNPay IPN (server→server) | VNPay | Endpoint xác thực chữ ký HMAC + số tiền, cập nhật `Payment`, **cộng credit/kích hoạt Pro (nguồn sự thật)**, idempotent theo `vnpTxnRef`. | P0 |
| FR-20 | Admin | Quản lý thanh toán & doanh thu | Admin | Danh sách `Payment`, lọc trạng thái, tổng doanh thu VND, tổng credit lưu hành. | P1 |
| FR-21 | Admin | Kiểm duyệt ảnh Premium | Admin | Gỡ/ẩn ảnh vi phạm; xử lý refund credit nếu cần. | P2 |
| FR-22 | Premium | Xoá pin đã có người mua | Creator | Không xoá cứng; chuyển **archived**, người đã mua **vẫn tải được**; gỡ khỏi feed/market. | P1 |

---

## 6. Mô hình dữ liệu (Prisma / PostgreSQL)

### 6.1. Sửa model có sẵn

```prisma
model User {
  // ... field hiện có ...
  isPro           Boolean   @default(false)
  proExpiresAt    DateTime?
  wallet          Wallet?
  subscriptions   Subscription[]
  payments        Payment[]
  entitlements    PinEntitlement[]
  creditTxns      CreditTransaction[]
}

model Pin {
  // ... field hiện có ...
  isPremium     Boolean  @default(false)
  priceCredits  Int?                    // giá bán (credit), null nếu free
  previewUrl    String?                 // bản watermark công khai (dùng cho pin Premium)
  originalPath  String?                 // key file HD trong bucket PRIVATE (không public)
  isArchived    Boolean  @default(false)
  entitlements  PinEntitlement[]
}
```

> Với pin Premium: `imageUrl`/`previewUrl` = **preview watermark công khai**; `originalPath` = **HD gốc private**. Với pin free: `imageUrl` = ảnh thường như hiện tại.

### 6.2. Model mới

```prisma
model Wallet {
  userId          String   @id
  spendable       Int      @default(0)   // credit dùng để tải (grant + mua)
  grantExpiresAt  DateTime?              // hạn của phần credit tặng theo Pro
  earnings        Int      @default(0)   // credit thu nhập từ bán ảnh
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Subscription {
  id         String   @id @default(uuid())
  userId     String
  plan       SubPlan
  status     SubStatus @default(ACTIVE)
  startedAt  DateTime  @default(now())
  expiresAt  DateTime
  paymentId  String?
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}
enum SubPlan   { MONTHLY YEARLY }
enum SubStatus { ACTIVE EXPIRED CANCELLED }

model Payment {
  id              String        @id @default(uuid())
  userId          String
  provider        String        @default("VNPAY")
  purpose         PaymentPurpose
  amountVnd       Int
  planCode        String?       // MONTHLY | YEARLY (nếu mua Pro)
  packCode        String?       // S | M | L | XL (nếu mua credit)
  creditsGranted  Int?          // số credit sẽ cộng khi PAID
  status          PaymentStatus @default(PENDING)
  vnpTxnRef       String        @unique   // mã đơn gửi VNPay (idempotency)
  vnpTransactionNo String?
  createdAt       DateTime      @default(now())
  paidAt          DateTime?
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}
enum PaymentPurpose { PRO_SUB CREDIT_PACK }
enum PaymentStatus  { PENDING PAID FAILED EXPIRED }

model PinEntitlement {
  userId      String
  pinId       String
  creditsPaid Int
  grantedAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  pin         Pin      @relation(fields: [pinId], references: [id], onDelete: Cascade)
  @@id([userId, pinId])
  @@index([pinId])
}

model CreditTransaction {
  id          String   @id @default(uuid())
  userId      String
  type        CreditTxnType
  amount      Int          // + cộng, - trừ
  balanceAfter Int
  refPinId    String?
  refPaymentId String?
  note        String?
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}
enum CreditTxnType {
  PURCHASE MONTHLY_GRANT SPEND_DOWNLOAD EARN_SALE PLATFORM_FEE GRANT_EXPIRE REFUND
}
```

---

## 7. API endpoints

> Prefix `api/` như các module hiện có. Dùng `SupabaseAuthGuard` + `@CurrentUser()`.

### Billing / Pro / Credit
| Method | Route | Guard | Mô tả |
|---|---|---|---|
| GET | `/api/billing/plans` | — | Bảng giá Pro + credit packs (từ config). |
| GET | `/api/billing/me` | Auth | Trạng thái Pro (`isPro`, `proExpiresAt`) + số dư ví. |
| POST | `/api/billing/subscribe` | Auth | Body `{ plan }` → tạo `Payment` + trả `{ payUrl }` VNPay. |
| POST | `/api/billing/credits/purchase` | Auth | Body `{ packCode }` → `Payment` + `{ payUrl }`. |
| GET | `/api/billing/vnpay/return` | — | Redirect người dùng về; chỉ hiển thị kết quả (không cộng tiền). |
| GET/POST | `/api/billing/vnpay/ipn` | — (verify chữ ký) | **Nguồn sự thật**: xác thực HMAC + số tiền, cập nhật `Payment`, cộng credit / kích hoạt Pro. Idempotent. |
| GET | `/api/billing/transactions` | Auth | Lịch sử `CreditTransaction`. |

### Premium Pin / Marketplace
| Method | Route | Guard | Mô tả |
|---|---|---|---|
| POST | `/api/pins` (mở rộng) | Auth | Thêm `isPremium`, `priceCredits`; backend sinh preview + lưu HD private. |
| PATCH | `/api/pins/:id/premium` | Auth (chủ) | Bật/tắt Premium, đổi giá. |
| GET | `/api/pins/:id/access` | Auth | `{ owned, purchased, isPremium, priceCredits }` để render nút phù hợp. |
| POST | `/api/pins/:id/purchase` | Auth | Trả credit → tạo `Entitlement` + chia doanh thu. Idempotent. |
| GET | `/api/pins/:id/download` | Auth (entitlement/chủ/Pro-free) | Giao HD: trả **signed URL 1 lần** hoặc stream attachment; đính watermark ẩn. |
| GET | `/api/creator/earnings` | Auth | Thu nhập credit + danh sách ảnh đã bán. |

### AI
| Method | Route | Guard | Mô tả |
|---|---|---|---|
| GET | `/api/ai-generator/quota` | Auth | Số lượt còn lại hôm nay + trạng thái Pro. |
| POST | `/api/ai-generator/generate` (enforce) | Auth | Kiểm quota trước khi gọi Pollinations; Pro bỏ qua giới hạn. |

### Admin
| Method | Route | Guard | Mô tả |
|---|---|---|---|
| GET | `/api/admin/payments` | Admin | Danh sách đơn + lọc. |
| GET | `/api/admin/revenue` | Admin | Tổng doanh thu VND, credit lưu hành. |

---

## 8. Luồng nghiệp vụ chính

### 8.1. Mua Pro / mua credit pack (VNPay)
1. User bấm mua → FE gọi `POST /api/billing/subscribe` (hoặc `/credits/purchase`).
2. BE tạo `Payment(status=PENDING, vnpTxnRef=random-unique)`, ký URL VNPay (HMAC-SHA512 với `vnp_HashSecret`), trả `payUrl`.
3. FE redirect người dùng sang VNPay; user thanh toán.
4. VNPay gọi **IPN** `→` BE: verify chữ ký + `vnp_Amount` khớp `amountVnd*100` + `vnpTxnRef` tồn tại & đang PENDING → set `PAID`, cộng credit / set `isPro=true, proExpiresAt`, ghi `CreditTransaction`. **Idempotent** (đã PAID thì trả 200 và bỏ qua).
5. VNPay redirect user về `return` → FE hiển thị kết quả, poll `GET /api/billing/me` để cập nhật số dư.

> Quy tắc vàng: **chỉ IPN mới cộng tiền**, không bao giờ cộng dựa trên `return` (client có thể giả mạo).

### 8.2. Đăng ảnh Premium
1. Creator upload/lưu pin, bật **Premium**, nhập giá credit.
2. BE nhận file gốc → lưu **HD gốc vào bucket private** (`originalPath`); tạo **preview**: downscale (cạnh dài ≤ 640px) + nén + **watermark hiện** (logo + @username) → upload bucket public (`previewUrl`/`imageUrl`).
3. Feed & pin-detail chỉ dùng `previewUrl`. **Không** nhúng `originalPath`/URL HD ở bất kỳ đâu trên client.

### 8.3. Mua & tải ảnh Premium
1. User xem pin Premium → thấy preview watermark + nút "Tải HD – {giá} credit".
2. Bấm mua → `POST /api/pins/:id/purchase`: kiểm không phải chủ, đủ credit → trong 1 transaction DB: trừ credit người mua (`SPEND_DOWNLOAD`), cộng 70% creator (`EARN_SALE`) + 30% nền tảng (`PLATFORM_FEE`), tạo `Entitlement`.
3. Bấm tải → `GET /api/pins/:id/download`: BE kiểm entitlement → tạo **signed URL hết hạn 60s (dùng 1 lần)** hoặc stream attachment; **đính watermark ẩn buyerId** vào bản giao.
4. Lần sau tải lại: miễn phí (đã có entitlement).

---

## 9. Cơ chế bảo vệ ảnh Premium (chống F12)

> **Nói thẳng về giới hạn:** không có cách nào chặn 100% việc người dùng **chụp màn hình** thứ đang hiển thị. Nhưng **chặn được** việc lấy **file HD gốc, sạch, không watermark** — thứ có giá trị thương mại. Đây là mô hình Getty/Shutterstock.

### 9.1. Hai phiên bản cho mỗi ảnh Premium
- **Preview (công khai):** downscale (≤ 640px), nén mạnh, **watermark hiện rõ** (logo + @username lặp chéo). Đây là **thứ DUY NHẤT** F12/network/`view-source` thấy trong feed & pin-detail. Chụp màn hình bản này thì nhỏ + dính watermark → vô giá trị.
- **Original HD (riêng tư):** lưu **bucket private** của Supabase Storage (RLS chặn, **không public URL**). **Không bao giờ** nhúng vào DOM.

### 9.2. Vì sao F12 không lấy được HD
- Pin Premium render bằng `previewUrl` → trong Network chỉ có bytes của preview watermark.
- **Không tồn tại** thẻ `<img>`/CSS `background`/`fetch` nào trỏ tới HD → không có URL để copy.
- HD chỉ ra khỏi server qua `GET /api/pins/:id/download`, có `SupabaseAuthGuard` + kiểm entitlement. Không có quyền → **403/402**, không phải ảnh.

### 9.3. Giao HD an toàn (sau khi đã mua)
- Trả **signed URL hết hạn ~60s, dùng 1 lần** (Supabase `createSignedUrl`) hoặc **stream** file qua backend với `Content-Disposition: attachment` + `Cache-Control: no-store`.
- **Watermark ẩn (forensic/steganography):** nhúng mã `buyerId`+`pinId` không nhìn thấy vào bản HD lúc giao → nếu ảnh bị phát tán, **truy được** ai làm lộ. Răn đe rò rỉ sau mua.
- **Rate-limit** endpoint download (vd 10 lượt/phút/user) chống cào hàng loạt.

### 9.4. Lớp phụ (UX, không phải bảo mật thật — vẫn nên có)
- Chặn right-click / kéo-thả ảnh preview, `user-select: none`, `pointer-events` phủ.
- Không log URL HD ra console; không đặt HD trong response JSON của feed.

### 9.5. Ranh giới trung thực
| Chống được | Không chống được (chấp nhận) |
|---|---|
| Copy URL HD từ Network/F12 | Chụp màn hình bản preview (nhỏ + watermark) |
| Right-click → Save bản HD | Người mua hợp lệ tự chụp lại (nhưng bị watermark ẩn truy nguồn) |
| Đoán/bruteforce link HD (signed, hết hạn nhanh) | — |
| Tải HD khi chưa trả credit (guard chặn) | — |

---

## 10. Đặc tả màn hình Frontend (Angular)

> Bám DESIGN.md: nút CTA đỏ Pinterest `#e60023`, bo góc 16px, Pin Sans/Inter.

| Màn hình / Route | Nội dung chính |
|---|---|
| **Nâng cấp Pro** `/pro` | 2 thẻ gói (tháng/năm), danh sách quyền lợi, nút đỏ "Nâng cấp" → VNPay. Badge "Tiết kiệm 17%" cho gói năm. |
| **Ví Credit** (trong `/settings`) | Số dư credit chi tiêu + thu nhập, hạn credit tặng, nút "Mua thêm credit" (4 pack), lịch sử giao dịch. |
| **Kết quả thanh toán** `/billing/result` | Trạng thái từ VNPay return; poll `billing/me`; nút về feed/ví. |
| **Create/Upload** (mở rộng) | Toggle "Bán ảnh này (Premium)" → hiện ô nhập **giá credit** + **xem trước preview có watermark**. |
| **Pin detail (Premium, chưa mua)** | Ảnh preview watermark; hộp giá "{giá} credit"; nút "Tải HD" → xác nhận trừ credit → tải. Nếu thiếu credit: CTA mua credit/Pro. |
| **Pin detail (đã mua/chủ)** | Nút "Tải HD" tải trực tiếp (đã có quyền). |
| **Hồ sơ Creator** | Huy hiệu Pro; tab "Thu nhập" (credit kiếm được, số ảnh đã bán). |
| **AI Generator** (mở rộng) | Chỉ báo quota "Còn 7/10 lượt hôm nay"; nếu Pro: "Không giới hạn". Free hết lượt → CTA Pro (hoặc trả credit nếu bật FR-17). |
| **Toàn cục** | Huy hiệu Pro cạnh avatar; badge "Premium" góc thumbnail pin có bán. |

---

## 11. Yêu cầu phi chức năng

| Nhóm | Yêu cầu |
|---|---|
| **Bảo mật** | Xác thực chữ ký VNPay HMAC-SHA512; kiểm `vnp_Amount` khớp; bucket HD private (RLS); mọi kiểm quyền tải ở **server-side**, không tin client; không bao giờ đặt secret VNPay ra FE. |
| **Toàn vẹn giao dịch** | Trừ/cộng credit trong **1 DB transaction** (Prisma `$transaction`); IPN **idempotent** theo `vnpTxnRef`; mua pin idempotent theo `(userId,pinId)`. |
| **Hiệu năng** | Sinh preview/watermark bất đồng bộ (queue) nếu ảnh lớn; signed URL cache ngắn; feed không kèm dữ liệu HD. |
| **Tính tiền** | Toàn bộ tiền lưu **số nguyên VND** (không số thực); credit là **số nguyên**. |
| **Audit** | Mọi biến động credit ghi `CreditTransaction` có `balanceAfter`; mọi `Payment` lưu `vnpTransactionNo`. |
| **Pháp lý** | Trang Điều khoản/Chính sách hoàn tiền; VAT (nếu phát hành hoá đơn — giai đoạn sau). |

---

## 12. Edge cases & quy tắc nghiệp vụ

1. **Mua ảnh của chính mình** → chặn (đã sở hữu).
2. **Mua lại ảnh đã có entitlement** → không trừ credit, cho tải luôn.
3. **Creator đổi giá** sau khi có người mua → không hồi tố người đã mua.
4. **Xoá pin Premium đã bán** → không xoá cứng; `isArchived=true`, người đã mua vẫn tải (§FR-22).
5. **Không đủ credit** → chặn + gợi ý mua credit/Pro.
6. **Credit tặng hết hạn** khi Pro hết hạn/sang kỳ mới → ghi `GRANT_EXPIRE`, trừ phần grant chưa dùng; credit mua giữ nguyên. Thứ tự tiêu: **ưu tiên tiêu credit tặng trước** (sắp hết hạn).
7. **IPN đến muộn/lặp** → idempotent, chỉ cộng 1 lần.
8. **Return trước IPN** → FE hiển thị "đang xử lý", poll `billing/me`.
9. **Thanh toán thất bại/timeout** → `Payment=FAILED/EXPIRED`, không cộng gì.
10. **Signed URL bị chia sẻ** → hết hạn 60s + 1 lần dùng → vô hiệu nhanh; bản giao có watermark ẩn truy nguồn.
11. **Ảnh Premium vi phạm bản quyền** → admin gỡ + refund credit người mua (`REFUND`), thu hồi earnings creator.

---

## 13. Tiêu chí nghiệm thu (Acceptance Criteria)

- [ ] User mua Pro qua VNPay sandbox thành công → `isPro=true`, `proExpiresAt` đúng, +300 credit tặng, có huy hiệu Pro.
- [ ] User mua credit pack → số dư tăng đúng, ghi `CreditTransaction`.
- [ ] Creator đăng pin Premium → feed chỉ hiện preview watermark; **F12/Network không có URL HD**.
- [ ] User trả credit → tạo entitlement, creator +70%, nền tảng +30%, người mua tải được HD sạch.
- [ ] Chưa mua mà gọi `/download` → **403/402**, không nhận file.
- [ ] Free tạo AI đủ 10 lượt → lượt 11 bị chặn; Pro tạo không giới hạn.
- [ ] IPN gọi 2 lần cùng `vnpTxnRef` → credit chỉ cộng 1 lần.
- [ ] Mua ảnh của chính mình → bị chặn.
- [ ] Đổi giá sau khi bán → người đã mua không bị ảnh hưởng.

---

## 14. Phạm vi & rủi ro

**Trong phạm vi (MVP):** Pro sub + credit + chợ ảnh Premium + VNPay (IPN/return) + bảo vệ HD (preview watermark + private bucket + signed URL + entitlement) + quota AI + ví/lịch sử + admin doanh thu cơ bản.

**Ngoài phạm vi (giai đoạn sau):** rút tiền mặt cho creator (payout), auto-renew Pro, hoá đơn VAT, đa tiền tệ, MoMo/Stripe, watermark ẩn nâng cao (steganography thật thay vì metadata), hàng đợi kiểm duyệt ảnh.

**Rủi ro chính:**
- *Người mua hợp lệ phát tán HD* → giảm thiểu bằng watermark ẩn truy nguồn + điều khoản.
- *Gian lận thanh toán / thao túng IPN* → verify chữ ký + số tiền + idempotency; không tin `return`.
- *Cost AI vượt dự toán* → soft cap Pro + quota Free + tuỳ chọn trả credit vượt quota.
- *Định giá sai* → toàn bộ giá/credit để ở bảng cấu hình, chỉnh không cần deploy lại.

---

## Phụ lục A — Bảng cấu hình (constants)

| Khoá | Giá trị đề xuất |
|---|---|
| `PRO_MONTHLY_VND` | 79000 |
| `PRO_YEARLY_VND` | 790000 |
| `PRO_MONTHLY_GRANT_CREDITS` | 300 |
| `CREDIT_PACKS` | S:100/20000 · M:300/55000 · L:700/120000 · XL:1500/240000 |
| `PREMIUM_PRICE_MIN/MAX` | 10 / 500 credit (bội số 5) |
| `PLATFORM_FEE_PERCENT` | 30 |
| `AI_FREE_DAILY_LIMIT` | 10 |
| `AI_PRO_SOFT_CAP` | 200 |
| `AI_OVERAGE_CREDIT_PER_GEN` | 5 (nếu bật FR-17) |
| `PREVIEW_MAX_EDGE_PX` | 640 |
| `DOWNLOAD_SIGNED_URL_TTL_SEC` | 60 |
