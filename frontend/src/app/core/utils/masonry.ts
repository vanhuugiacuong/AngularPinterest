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
 *
 * 270, không phải 300. Với 300 thì ngưỡng lên 6 cột rơi vào khổ nội dung 1501,
 * tức viewport ~1565 — nên màn 1440 và 1536 (rất phổ biến, gồm cả 1920 vật lý ở
 * mức phóng đại 125% của Windows) chỉ được 5 cột ở zoom 100%. Zoom ra 90% nhân
 * viewport lên ~1,11 lần, vượt ngưỡng, và lưới nhảy lên 6 — đó chính là lý do
 * 90% trông khác 100%, không phải lỗi.
 *
 * 270 hạ ngưỡng xuống khổ nội dung 1351 (viewport ~1415), nên các màn đó được 6
 * cột ngay ở 100%. Cố ý KHÔNG hạ tới 260: mức đó kéo cả màn 1366 lên 6 cột, cột
 * chỉ còn ~204px — ảnh vụn trên đúng loại máy có ít chỗ nhất. */
export const MASONRY_TARGET_COLUMN_WIDTH = 270;

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;

/** Khổ nội dung thật: viewport trừ padding ngang của <main>, và không vượt quá
 * mức chặn `max-w-[...]`. Truyền `clientWidth` (đã trừ scrollbar), không phải
 * `innerWidth`. */
export function masonryContentWidth(viewportWidth: number, horizontalPadding: number): number {
  return Math.min(MASONRY_MAX_CONTENT_WIDTH, viewportWidth - horizontalPadding);
}

/** `ceil` để giữ bất biến: không cột nào rộng hơn MASONRY_TARGET_COLUMN_WIDTH.
 *
 * Lưu ý: kể từ khi target là 270, mức chặn MAX_COLUMNS thật sự có tác dụng chứ
 * không còn là dự phòng — khổ nội dung 1800 cho ceil = 7 và bị chặn về 6, ra cột
 * ~287px. Sửa MAX_COLUMNS là đổi luôn dáng lưới ở màn rộng. */
export function masonryColumnCount(contentWidth: number): number {
  const columns = Math.ceil(contentWidth / MASONRY_TARGET_COLUMN_WIDTH);
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, columns));
}
