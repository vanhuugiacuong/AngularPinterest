/** Số cột cho lưới masonry — dùng chung cho Khám phá (Home) và khối ảnh liên
 * quan của Pin Detail, để cùng một khổ nội dung luôn cho ra ảnh cùng cỡ ở cả
 * hai trang.
 *
 * Vì sao tính từ chiều rộng NỘI DUNG chứ không phải `window.innerWidth`: khối
 * nội dung bị chặn ở MASONRY_MAX_CONTENT_WIDTH, nên mọi viewport rộng hơn
 * ngưỡng đó đều có cùng khổ nội dung và phải ra cùng số cột. Dựa vào innerWidth
 * thì cùng một khổ 1800px lại cho số cột khác nhau giữa các mức zoom (ví dụ 5
 * cột ở zoom 90% nhưng 4 cột ở zoom 100%), khiến ảnh phình/teo bất thường. */

/** Phải khớp `max-w-[1800px]` của khối nội dung trong home.html và
 * pin-detail.html. */
export const MASONRY_MAX_CONTENT_WIDTH = 1800;

/** Chiều rộng tối đa mong muốn cho một cột. Cột rộng hơn mức này thì ảnh to
 * quá và một hàng chỉ còn vài tấm; hẹp hơn nhiều thì ảnh vụn thành thumbnail.
 * 300px cho ra 6 cột ở khổ nội dung 1800px (cột thật ~290px) — đúng cỡ ảnh của
 * Pinterest. */
export const MASONRY_TARGET_COLUMN_WIDTH = 300;

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;

/** Khổ nội dung thật: viewport trừ padding ngang của <main>, và không vượt quá
 * mức chặn `max-w-[...]`. Truyền `clientWidth` (đã trừ scrollbar), không phải
 * `innerWidth`. */
export function masonryContentWidth(viewportWidth: number, horizontalPadding: number): number {
  return Math.min(MASONRY_MAX_CONTENT_WIDTH, viewportWidth - horizontalPadding);
}

/** `ceil` để giữ bất biến: không cột nào rộng hơn MASONRY_TARGET_COLUMN_WIDTH.
 * Khổ nội dung không bao giờ vượt 1800 nên kết quả tối đa đúng bằng 6. */
export function masonryColumnCount(contentWidth: number): number {
  const columns = Math.ceil(contentWidth / MASONRY_TARGET_COLUMN_WIDTH);
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, columns));
}
