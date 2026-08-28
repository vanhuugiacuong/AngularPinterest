/**
 * Số hiển thị trên huy hiệu thông báo (chuông, tab quản trị, nút Quản trị...).
 *
 * Từ 10 trở lên thì hiện "9+" thay vì số thật. Lý do: huy hiệu là hình tròn nhỏ
 * nằm đè lên góc icon — nhét số 2-3 chữ số vào là nó phình ngang, che mất icon
 * bên dưới và phá bố cục hàng nút. Mà quá 9 thì con số chính xác cũng không còn
 * đổi hành vi người dùng: 12 hay 47 việc tồn thì cũng là "nhiều, phải xử lý",
 * xem chi tiết đã có ngay trong trang.
 */
export function badgeCount(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return v > 9 ? '9+' : String(v);
}
