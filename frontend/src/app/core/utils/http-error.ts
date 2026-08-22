/** Chuẩn hoá lỗi gọi API thành thông báo tiếng Việt cho người dùng.
 *
 * `fetch()` reject với `TypeError: Failed to fetch` khi có sự cố mạng thật sự
 * (backend không phản hồi, CORS chặn, mất kết nối...) - khác với lỗi HTTP đã
 * có response (401, 404...) vốn đã được dịch sẵn ở nơi gọi. Nếu không được
 * nhận diện riêng, message tiếng Anh gốc của trình duyệt sẽ lọt thẳng ra UI. */
export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
    return 'Không thể kết nối đến máy chủ. Vui lòng thử lại.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

/** Bọc quanh `fetch()` để dịch lỗi mạng cấp thấp (fetch tự reject) ngay tại
 * nguồn, trước khi nó có cơ hội bay lên UI dưới dạng "Failed to fetch". Lỗi
 * HTTP đã có response (status không ok) vẫn được xử lý bình thường ở caller. */
export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
    }
    throw error;
  }
}
