/** Formatter tiền tệ dùng chung toàn app — chỉ hỗ trợ VND ở giai đoạn này.
 * Dùng Intl.NumberFormat thay vì tự ghép chuỗi để đảm bảo đúng chuẩn phân
 * tách hàng nghìn và ký hiệu tiền tệ theo locale tiếng Việt. */
const VND_FORMATTER = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

/** Nhận number hoặc string (giá trị Decimal từ backend được serialize thành
 * chuỗi qua JSON) — trả '' nếu không có giá trị hợp lệ thay vì "NaN ₫". */
export function formatVnd(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';
  return VND_FORMATTER.format(value);
}
