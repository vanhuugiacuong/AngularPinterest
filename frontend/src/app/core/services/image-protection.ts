import { Injectable } from '@angular/core';

/**
 * Cản trở việc lưu ảnh qua thao tác phổ thông (chuột phải, kéo-thả, phím tắt
 * mở DevTools/View Source). Đây CHỈ là rào cản với người dùng thường —
 * không thể chặn tuyệt đối vì trình duyệt bắt buộc phải tải ảnh về máy để
 * hiển thị, nên ai mở được tab Network vẫn lấy được file gốc. Bảo vệ THẬT
 * cho ảnh Premium nằm ở kiến trúc bucket riêng tư + watermark (xem
 * Pin.previewUrl/originalPath trong schema.prisma), không phải ở đây.
 */
@Injectable({ providedIn: 'root' })
export class ImageProtectionService {
  private installed = false;

  install(): void {
    if (this.installed || typeof document === 'undefined') return;
    this.installed = true;

    // Chặn menu "Lưu hình ảnh..." khi chuột phải lên ảnh
    document.addEventListener(
      'contextmenu',
      (e) => {
        const target = e.target as HTMLElement;
        if (target?.tagName === 'IMG') e.preventDefault();
      },
      { capture: true },
    );

    // Chặn kéo ảnh ra ngoài (kéo-thả để lưu file)
    document.addEventListener(
      'dragstart',
      (e) => {
        const target = e.target as HTMLElement;
        if (target?.tagName === 'IMG') e.preventDefault();
      },
      { capture: true },
    );

    // Chặn phím tắt hay dùng để mở DevTools / xem mã nguồn.
    // Lưu ý: chỉ cản người dùng phổ thông — menu trình duyệt (vd: More tools
    // > Developer tools) và một số trình duyệt vẫn có thể bỏ qua preventDefault.
    document.addEventListener('keydown', (e) => {
      const key = e.key;
      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      if (key === 'F12') {
        e.preventDefault();
        return;
      }
      if (ctrlOrCmd && e.shiftKey && ['I', 'J', 'C', 'i', 'j', 'c'].includes(key)) {
        e.preventDefault();
        return;
      }
      if (ctrlOrCmd && (key === 'u' || key === 'U')) {
        e.preventDefault();
        return;
      }
    });
  }
}
