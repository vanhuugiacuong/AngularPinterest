import { Injectable, signal } from '@angular/core';

/** Lý do báo cáo dựng sẵn — chọn nhanh thay vì bắt người dùng tự gõ. */
export interface ReportReason {
  code: string;
  label: string;
  desc: string;
}

export const REPORT_REASONS: ReportReason[] = [
  { code: 'nudity', label: 'Ảnh khoả thân hoặc nhạy cảm', desc: 'Nội dung người lớn, phản cảm' },
  { code: 'violence', label: 'Bạo lực hoặc nguy hiểm', desc: 'Máu me, tự hại, hành vi nguy hiểm' },
  { code: 'spam', label: 'Spam hoặc lừa đảo', desc: 'Quảng cáo rác, dẫn dụ, giả mạo' },
  { code: 'hate', label: 'Ngôn từ thù ghét', desc: 'Công kích, phân biệt đối xử' },
  { code: 'copyright', label: 'Vi phạm bản quyền', desc: 'Ảnh của tôi bị đăng lại trái phép' },
  { code: 'false_info', label: 'Thông tin sai sự thật', desc: 'Nội dung gây hiểu lầm' },
  { code: 'other', label: 'Lý do khác', desc: 'Tự mô tả vấn đề bạn gặp phải' },
];

/** Lý do báo sự cố chuyển khoản — admin đọc trong trang quản trị. */
export const PAYMENT_REPORT_REASONS: ReportReason[] = [
  { code: 'not_received', label: 'Đã chuyển tiền nhưng chưa nhận được', desc: 'Ngân hàng đã trừ tiền mà tài khoản chưa được cộng' },
  { code: 'wrong_amount', label: 'Chuyển sai số tiền', desc: 'Chuyển thiếu hoặc thừa so với số tiền trên mã QR' },
  { code: 'wrong_memo', label: 'Chuyển sai nội dung', desc: 'Quên hoặc gõ sai nội dung chuyển khoản bắt buộc' },
  { code: 'double_charge', label: 'Bị trừ tiền hai lần', desc: 'Chuyển nhầm hai lần cho cùng một đơn' },
  { code: 'other', label: 'Lý do khác', desc: 'Tự mô tả sự cố bạn gặp phải' },
];

/** Giới hạn ô mô tả thêm. Backend cắt ở 500 nên 300 luôn nằm trong ngưỡng an toàn. */
export const REPORT_NOTE_MAX = 300;

/** Loại báo cáo — quyết định danh sách lý do và tiêu đề hộp thoại. */
export type ReportKind = 'pin' | 'payment';

interface PendingReport {
  /** Tiêu đề hiển thị (vd tên ảnh, mã đơn) — để chắc chắn báo cáo đúng thứ. */
  subject: string;
  kind: ReportKind;
  resolve: (reason: string | null) => void;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  public current = signal<PendingReport | null>(null);

  /** Mở hộp thoại báo cáo. Trả về chuỗi lý do, hoặc null nếu người dùng huỷ. */
  ask(subject: string, kind: ReportKind = 'pin'): Promise<string | null> {
    return new Promise((resolve) => {
      this.current.set({ subject, kind, resolve });
    });
  }

  respond(reason: string | null) {
    const pending = this.current();
    if (!pending) return;
    this.current.set(null);
    pending.resolve(reason);
  }
}
