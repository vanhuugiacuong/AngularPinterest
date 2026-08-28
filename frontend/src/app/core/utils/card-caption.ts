/** Ai được hiện tiêu đề / dòng tác giả dưới một card ảnh.
 *
 * Vì sao không phải card nào cũng hiện: lưới của Pinterest cố tình không đều —
 * có card mang tiêu đề, có card mang tên tác giả, phần lớn không mang gì — và
 * chính sự không đều đó giữ cho một bức tường ảnh không đọc thành bảng biểu.
 * Lưới của mình chú thích MỌI card, nên nhìn thành từng hàng đều tăm tắp.
 *
 * Vì sao băm từ id chứ không phải `Math.random()`: các hàm này được gọi từ
 * template, nên chúng chạy lại ở MỌI vòng change detection. Nguồn ngẫu nhiên sẽ
 * bật/tắt chú thích trong lúc người dùng cuộn, và mỗi lần bật/tắt là đổi chiều
 * cao card rồi kéo cả cột masonry chạy dưới tay họ. Băm id cho cùng một câu trả
 * lời với cùng một pin, mãi mãi.
 *
 * Vì sao là util dùng chung chứ không nằm trong home.ts: khối "Ảnh liên quan"
 * của Pin Detail là cùng một card. Mỗi trang giữ một bản riêng thì hai lưới sẽ
 * trôi ra khỏi nhau — và tệ hơn, CÙNG một pin xuất hiện ở hai trang lại được
 * chú thích khác nhau.
 */

/** Tỉ lệ pin được hiện tiêu đề / dòng tác giả, theo phần trăm. Tách hai số để
 *  chỉnh mật độ từng thứ độc lập. */
const TITLE_SHARE = 55;
const BYLINE_SHARE = 45;

/** Nhớ lại kết quả: template hỏi hai lần cho mỗi card ở mỗi vòng change
 *  detection, mà một feed có hàng trăm card. Map ở cấp module nên hai trang
 *  dùng chung một cache. */
const hashCache = new Map<string, number>();

/** FNV-1a 32-bit. */
function hashId(id: string): number {
  const cached = hashCache.get(id);
  if (cached !== undefined) return cached;
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash >>>= 0;
  hashCache.set(id, hash);
  return hash;
}

export function showsCardTitle(pin: { id?: string; title?: string } | null | undefined): boolean {
  // Pin không có tiêu đề thật thì không bao giờ được hàng đó, bất kể tỉ lệ:
  // trước đây nó render một <span> in đậm rỗng mà vẫn chiếm nguyên một dòng.
  if (!pin?.id || !pin.title?.trim()) return false;
  return hashId(pin.id) % 100 < TITLE_SHARE;
}

export function showsCardByline(pin: { id?: string } | null | undefined): boolean {
  if (!pin?.id) return false;
  // Lấy một lát khác của cùng giá trị băm. Dùng `% 100` trên cùng một số hai
  // lần sẽ buộc hai quyết định dính nhau, khiến mọi card có tiêu đề cũng có
  // dòng tác giả — lưới chỉ lệch theo MỘT chiều thay vì bốn tổ hợp.
  return (hashId(pin.id) >>> 8) % 100 < BYLINE_SHARE;
}
