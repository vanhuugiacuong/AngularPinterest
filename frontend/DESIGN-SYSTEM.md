# PinHub — Hệ thống thiết kế

> **Đọc file này TRƯỚC khi merge code giao diện.**
>
> Tài liệu này tồn tại vì một lý do cụ thể: nhiều lần merge đã đưa vào những màu
> và kiểu nút "gần giống" nhưng không trùng, khiến app trông như ghép từ nhiều
> sản phẩm khác nhau. Phần [Lỗi đã từng xảy ra](#8-lỗi-đã-từng-xảy-ra) liệt kê
> đúng những vụ đó — nếu code bạn sắp merge lặp lại một trong số đó, hãy sửa
> trước khi merge.

Quy tắc bao trùm: **không tự khai màu mới**. Nếu thứ bạn cần chưa có token, đó
là dấu hiệu nên dùng lại token đã có, chứ không phải nên thêm token.

---

## 1. Nguyên tắc nền

| | |
|---|---|
| **Chỉ có giao diện tối** | Không có light mode. Đừng thêm `:host-context(.dark)` cho code mới; component cũ còn sót thì để nguyên. |
| **Một nguồn sự thật** | Màu, gradient, bo góc đều lấy từ token trong `src/styles.css`. Không chép giá trị sang file component. |
| **Màu có nghĩa** | Mỗi màu mang một ý nghĩa cố định (mục 2.2). Dùng sai màu là nói sai nghĩa, không chỉ là xấu. |
| **Tiếng Việt** | Chữ hiển thị và comment trong code viết tiếng Việt. Comment giải thích **tại sao**, không mô tả **cái gì**. |

---

## 2. Màu

### 2.1 Token — `src/styles.css`

```css
@theme {
  --color-brand: #f94083;        /* hồng thương hiệu */
  --color-brand-2: #b15caa;      /* tím cuối gradient */
  --color-brand-soft: #ff6fa1;   /* hồng nhạt, dùng cho chữ/hover */

  --color-bg: #121212;           /* nền trang */
  --color-surface: #1a1a1a;      /* thẻ, bảng */
  --color-surface-2: #242424;
  --color-elevated: #2a2a2a;

  --color-hairline: rgba(255, 255, 255, 0.08);
  --color-hairline-strong: rgba(255, 255, 255, 0.14);

  --color-ink: #ffffff;          /* chữ chính */
  --color-muted: #a29aac;        /* chữ phụ */
  --color-faint: #6c6674;        /* chữ mờ, placeholder */
}
```

Dùng như utility Tailwind: `bg-surface`, `text-muted`, `border-hairline`.

**Gradient thương hiệu** — dùng cho CTA bán hàng (xem §3.1):

```css
--grad-brand: linear-gradient(120deg, #ff6f9c 0%, #f94083 32%, #d454a8 62%, #b15caa 100%);
```

Cách dùng: class `grad-brand`, hoặc `background-image: var(--grad-brand)`.
**Không** viết lại chuỗi gradient trong file component.

### 2.2 Màu ngữ nghĩa — mỗi màu một việc

| Màu | Mã | Nghĩa | Ví dụ |
|---|---|---|---|
| Hồng | `#f94083` | Thương hiệu, hành động chính, Pro | Nút Lưu, nút Tạo, nâng cấp Pro |
| Xanh lá | `#34c17f` / `#5fd39a` | Dòng tiền, thành công | Rút tiền, "Đã chuyển", ví |
| Vàng | `#e8c468` | Tiền/Premium, đang chờ | Ảnh Premium, "Chờ duyệt", doanh thu |
| Đỏ | `#ff5c7a` | Vi phạm, lỗi, huỷ | Báo cáo, "Từ chối", khoá tài khoản |
| Xanh dương | `#5b9cff` / `#7fb4ff` | Tài khoản, đang xử lý | Người dùng, "Đã duyệt" |
| Cam | `#f0a03c` | Sự cố chuyển khoản | Tab sự cố ở trang quản trị |
| Tím | `#8b7bf0` | Khu quản trị, danh tính | Huy hiệu ADMIN, ảnh AI |
| Bạc chrome | `--grad-chrome` | **Chỉ** Pro năm | Viền avatar, huy hiệu gói năm |

> Hồng dành cho *mua*, xanh lá cho *tiền ra*. Đặt nút hồng giữa khu rút tiền là
> lệch nghĩa — dùng xanh lá.

**Màu hover chuẩn của hồng là `#dc2f6d`.** Không tự chế màu hover khác.

### 2.3 Cấp bậc bề mặt

```
#0d0d0d   khung app (header, sidebar) — tối nhất, để lùi ra sau
#121212   nền trang
#1a1a1a   thẻ, bảng
#1e1e1e   modal / hộp thoại (ConfirmDialog, chọn ảnh, sửa ảnh)
```

---

## 3. Nút

### 3.1 Chọn biến thể theo VAI TRÒ, không theo cảm tính

| Vai trò | Kiểu | Dùng ở |
|---|---|---|
| **Hành động thường** | Hồng **phẳng** `#f94083`, hover `#dc2f6d`, chữ trắng | Lưu, Tạo, Gửi, Theo dõi — kiểu phổ biến nhất |
| **CTA bán hàng / cao cấp** | `var(--grad-brand)` | Nâng cấp Pro, mua gói, "Bắt đầu ngay", chọn ảnh |
| **Hành động chính trong khu có màu riêng** | Gradient theo màu khu | Nút rút tiền dùng xanh lá, không dùng hồng |
| **Hành động phụ** | Nền `rgba(255,255,255,.06)` + viền `rgba(255,255,255,.12)` | Huỷ, Bỏ qua, Đóng |
| **Hành động nguy hiểm** | Tông đỏ nhạt, **đổ đặc khi hover** | Gỡ ảnh, Từ chối, Khoá |
| **Nút trắng** | Nền trắng, chữ tối | CHỈ khi buộc phải vậy: đăng nhập Google (quy ước của Google), nút nằm trên ảnh (cần tương phản) |

Chọn giữa hai kiểu hồng: **phẳng cho thao tác thường, gradient khi đang bán một
thứ gì đó.** Đừng đổi kiểu chỉ vì thấy đẹp hơn — người dùng học được rằng
gradient nghĩa là "cái này tốn tiền".

Nút **luôn** bo tròn hoàn toàn (`999px`), không phải `24px` hay `12px`.

`#b15caa` là **đuôi của gradient**, không phải màu nút. Đừng dùng nó làm nền
phẳng cho nút (đã từng dính ở hai trang bảng).

### 3.2 Bắt buộc

- Icon và chữ cùng hàng: `display:inline-flex; align-items:center; gap:6px; line-height:1`.
- Nút **đổi nhãn theo trạng thái** (Khoá ↔ Mở khoá) phải đặt `min-width` chung.
  Không đặt thì mỗi lần đổi trạng thái nút nhảy chỗ và các hàng trong bảng lệch nhau.
- Nút bị vô hiệu: `opacity: .5` + `cursor: not-allowed`, không đổi màu nền.
- Có hành động là phải nhìn ra bấm được: chỉ `cursor:pointer` là **không đủ** —
  cần đổi viền/nền khi hover, hoặc mũi tên chỉ hướng.

---

## 4. Bóng đổ và hiệu ứng sáng

> Người dùng dự án này **không thích quầng sáng màu**. Đây là quy ước bắt buộc,
> không phải gợi ý.

| Loại | Được dùng? |
|---|---|
| Bóng đen trung tính `rgba(0,0,0,x)` trên modal/dropdown/tooltip | ✅ cần, để lớp nổi tách khỏi nền |
| Vòng focus `0 0 0 3px` | ✅ cần cho trợ năng bàn phím |
| Viền mảnh `inset 0 0 0 1px` | ✅ |
| **Quầng sáng màu** lan ra ngoài (`0 10px 26px rgba(hồng)`) | ⚠️ chỉ ở bề mặt bán hàng (Pro, thẻ ngân hàng) |
| **Lớp phủ `radial-gradient` phát sáng** | ⚠️ như trên |
| `filter: drop-shadow()` phát sáng trên icon | ⚠️ như trên |

Tuyệt đối **không** thêm quầng sáng cho nút thao tác thường, thẻ dữ liệu, hay
bảng ở trang quản trị.

### Dải sáng lướt (sheen)

Hiệu ứng vệt sáng chạy ngang chỉ dùng cho **danh tính / bán hàng**: icon
sidebar, chuông thông báo, chip Pro, nút nâng cấp, thẻ ngân hàng, nút CTA trang
giới thiệu. Cho nó chạy trên nút thao tác thường sẽ làm nó mất hết ý nghĩa, và
danh sách dài sẽ chớp nháy rối mắt.

Cách làm: `::after` trượt bằng `background-position`, **không** dùng `transform`
— nút không đặt được `overflow:hidden` (tooltip phải tràn ra), dịch cả phần tử
thì vệt sáng bay ra ngoài.

Mọi hiệu ứng chuyển động đều phải có:

```css
@media (prefers-reduced-motion: reduce) { /* tắt animation */ }
```

---

## 5. Thành phần dùng lại

| Thành phần | Dùng khi | Ghi chú |
|---|---|---|
| **Hero** | Đầu trang lớn (Pro, Quản trị, Bị khoá) | Khối bo `28px`, quầng sáng, icon mờ khổng lồ làm nền, chữ mào giãn `.28em`, headline có một từ tô gradient |
| **Huy hiệu (crest)** | Đầu thẻ/khối | Vuông bo `12–14px` (hoặc tròn), nền gradient, icon trắng |
| **Nhãn trạng thái** | Trạng thái đơn/tài khoản | Viên thuốc + **chấm tròn** phía trước, cỡ chữ 10px |
| **Chip lọc** | Lọc danh sách | Viên thuốc; chip lọc theo trạng thái mang đúng màu trạng thái đó |
| **Dropdown** | Chọn từ danh sách | **Tự vẽ**, không dùng `<select>` gốc — popup của select do hệ điều hành vẽ, không style được |
| **Trạng thái rỗng** | Danh sách trống | Icon + một dòng nói rõ lý do. "Sạch việc" (dấu tích) khác "không tìm thấy" (kính lúp gạch chéo) |
| **`app-count-up`** | Số tiền quan trọng | `shared/count-up/` — quay như máy đếm cơ. Chỉ dùng cho vài số nổi bật, không dùng tràn lan |
| **`badgeCount()`** | Huy hiệu số | `shared/badge-count.ts` — quá 9 hiện `9+` |

### Ô tìm kiếm

Tìm **ngay khi gõ**, không cần nút "Tìm". Hai tầng:
lọc tại chỗ (tức thì, không chờ mạng) + gọi server hoãn ~300ms (tìm toàn bộ dữ liệu).
Lọc tại chỗ còn chặn lỗi phản hồi về trái thứ tự.

---

## 6. Chữ

| Vai trò | Cỡ | Đậm |
|---|---|---|
| Tiêu đề trang | 26–34px | 800 |
| Tiêu đề mục (`h2`) | 15px | 800 |
| Chữ thân | 13–14px | 400–600 |
| Chữ phụ | 11–12px | 400 |
| Chữ mào (eyebrow) | 10px, giãn `.28em`, IN HOA | 800 |

Số liệu (tiền, credit, ngày) **luôn** dùng `font-variant-numeric: tabular-nums`
để cột số không nhảy.

---

## 7. Bố cục

- Nội dung chính: `max-width` 1200–1400px, `mx-auto`.
- Chừa chỗ cho khung app: `pt-16` (header) và `pl-28` (sidebar).
- Ngưỡng chuyển sang nhiều cột: `lg:` (1024px).
- Bo góc: nút `999px` · thẻ `16–18px` · modal/hero `24–28px`.

> **Bẫy đã dính:** một phần tử là flex item trong cột flex, nếu đặt
> `margin-left/right: auto` thì nó **co lại vừa nội dung**, không giãn tới
> `max-width`. Phải thêm `width: 100%`.

---

## 8. Lỗi đã từng xảy ra

Đây là những lỗi **thật** đã lọt vào code. Kiểm tra code sắp merge có dính không:

1. **Màu "gần giống" nhưng không trùng.** `#ff2e8e`, `#ff6fd8`, `#e84fbe`,
   `#e85d8d` từng được dùng thay cho `#f94083`; `#b15caa` bị dùng làm nền nút.
   Tệ nhất: hai nút "Tạo" **giống hệt nhau** trong cùng một file mà khác màu.
   → Chỉ dùng token.

2. **Component tự khai bảng màu riêng.** Ba component sửa ảnh mỗi cái tự đặt
   `--pinhub-accent: #ff2e8e` + nền riêng, nên cả một luồng không giống phần còn
   lại của app. → Component con phải thừa hưởng token toàn cục.

3. **Chép `.grad-btn` sang nhiều file.** Một file quên định nghĩa → nút render
   **trong suốt hoàn toàn**. → Dùng class `grad-brand` toàn cục.

4. **`<select>` gốc.** Popup do hệ điều hành vẽ (nền trắng, tô xanh dương), lạc
   hẳn khỏi giao diện tối. → Tự vẽ dropdown.

5. **Cùng một trạng thái, hai nơi hai màu.** Đơn rút tiền "Đã duyệt" tô tím ở
   trang quản trị nhưng xanh dương ở trang ví. → Trạng thái dùng chung phải
   thống nhất màu ở mọi nơi.

6. **Nút chính dùng kiểu chìm.** Nút "Đã xử lý" — hành động chính duy nhất của
   thẻ — lại dùng biến thể `ghost` dành cho hành động phụ.

7. **Quầng sáng rải khắp nơi.** Từng có 60 khai báo bóng đổ màu + 8 lớp phủ phát
   sáng. Xem mục 4.

8. **Huy hiệu đè lên icon.** Huy hiệu số đặt trong lòng nút 44px sẽ che góc icon
   → đặt ra **ngoài** góc (`top:-4px; right:-4px`) và cho `z-index` cao hơn lớp
   sheen (vì `::after` sinh sau các phần tử con nên mặc định vẽ đè lên).

---

## 9. Danh sách kiểm trước khi merge

- [ ] Không có mã màu mới nào ngoài token trong §2
- [ ] Nút chính dùng `var(--grad-brand)` + `border-radius: 999px`
- [ ] Mỗi khối chỉ có một nút chính; nút phụ dùng kiểu chìm
- [ ] Không có quầng sáng màu trên nút/thẻ thao tác
- [ ] Không dùng `<select>` gốc
- [ ] Trạng thái dùng chung trùng màu với nơi khác đã hiển thị nó
- [ ] Danh sách có trạng thái rỗng, nói rõ lý do
- [ ] Số liệu dùng `tabular-nums`
- [ ] Animation có nhánh `prefers-reduced-motion`
- [ ] Chữ hiển thị bằng tiếng Việt
- [ ] `npx tsc --noEmit -p tsconfig.app.json` sạch

---

## 10. Nơi tra cứu

| Cần gì | Xem file |
|---|---|
| Token, gradient, chrome | `src/styles.css` |
| Nút / chip / bảng / trạng thái rỗng | `src/app/features/admin/admin.css` |
| Hero, huy hiệu, tô chữ gradient | `src/app/features/pro/pro.css` |
| Dropdown tự vẽ | `src/app/features/wallet/wallet.css` (`.payout-bank-*`) |
| Sheen | `src/app/components/navbar/navbar.css` (`rail-sheen`) |
| Quay số | `src/app/shared/count-up/` |
| Huy hiệu số | `src/app/shared/badge-count.ts` |
