import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ReportService,
  REPORT_REASONS,
  PAYMENT_REPORT_REASONS,
  REPORT_NOTE_MAX,
} from '../../core/services/report';

/**
 * Hộp thoại báo cáo ảnh: chọn lý do dựng sẵn, chọn "Lý do khác" thì mở ô mô tả
 * có đếm ký tự. Dùng chung tông với ConfirmDialog (nền #1e1e1e, scrim mờ) để
 * không lệch khỏi hệ thống dialog hiện có.
 */
@Component({
  selector: 'app-report-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-dialog.html',
  styleUrl: './report-dialog.css',
})
export class ReportDialog {
  public reportService = inject(ReportService);

  public readonly noteMax = REPORT_NOTE_MAX;

  /** Danh sách lý do đổi theo loại báo cáo: ảnh vi phạm hay sự cố chuyển khoản. */
  get isPayment(): boolean {
    return this.reportService.current()?.kind === 'payment';
  }
  get reasons() {
    return this.isPayment ? PAYMENT_REPORT_REASONS : REPORT_REASONS;
  }
  get title(): string {
    return this.isPayment ? 'Báo sự cố chuyển khoản' : 'Báo cáo ảnh';
  }
  get lead(): string {
    return this.isPayment
      ? 'Cho chúng tôi biết vấn đề bạn gặp với đơn thanh toán. Đội ngũ sẽ kiểm tra sao kê và xử lý.'
      : 'Cho chúng tôi biết vấn đề với ảnh này. Báo cáo của bạn được giữ ẩn danh.';
  }

  public selected = signal<string | null>(null);
  public note = '';

  get isOther(): boolean {
    return this.selected() === 'other';
  }

  get noteLeft(): number {
    return this.noteMax - this.note.length;
  }

  /** "Khác" bắt buộc mô tả; các lý do dựng sẵn thì chỉ cần chọn. */
  get canSubmit(): boolean {
    const code = this.selected();
    if (!code) return false;
    if (code === 'other') return this.note.trim().length > 0;
    return true;
  }

  pick(code: string) {
    this.selected.set(code);
    if (code !== 'other') this.note = '';
  }

  submit() {
    if (!this.canSubmit) return;
    const code = this.selected()!;
    const label = this.reasons.find((r) => r.code === code)?.label ?? code;
    const trimmed = this.note.trim().slice(0, this.noteMax);
    // Gửi kèm mô tả để người kiểm duyệt có ngữ cảnh, không chỉ mỗi mã lý do.
    const reason = trimmed ? `${label} — ${trimmed}` : label;
    this.reset();
    this.reportService.respond(reason);
  }

  cancel() {
    this.reset();
    this.reportService.respond(null);
  }

  private reset() {
    this.selected.set(null);
    this.note = '';
  }
}
