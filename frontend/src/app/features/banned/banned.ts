import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';

/**
 * Trang hiện khi tài khoản bị khoá.
 *
 * Vì sao cần cả một trang riêng: backend chặn người bị khoá ở tầng guard, nên
 * MỌI request đều trả 403. Không có trang này thì người bị khoá chỉ thấy app
 * hỏng lung tung — ảnh không tải, bấm gì cũng lỗi — mà không biết mình bị khoá,
 * càng không biết liên hệ ai để khiếu nại.
 */
@Component({
  selector: 'app-banned',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './banned.html',
  styleUrl: './banned.css',
})
export class Banned {
  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private toast = inject(ToastService);

  public readonly supportEmail = 'thanhliem21112006@gmail.com';
  public copied = signal(false);

  get userEmail(): string {
    return this.supabase.user()?.email ?? '';
  }

  /** Tiêu đề thư soạn sẵn — người dùng chỉ việc bấm gửi, đỡ phải tự nghĩ. */
  get mailtoLink(): string {
    const subject = encodeURIComponent('Khiếu nại tài khoản PinHub bị khoá');
    const body = encodeURIComponent(
      `Xin chào đội ngũ PinHub,\n\n` +
        `Tài khoản của tôi (${this.userEmail || '...'}) đang bị khoá. ` +
        `Tôi muốn được xem xét lại.\n\n` +
        `Lý do tôi cho rằng đây là nhầm lẫn:\n- \n\n` +
        `Cảm ơn đội ngũ.`,
    );
    return `mailto:${this.supportEmail}?subject=${subject}&body=${body}`;
  }

  copyEmail() {
    navigator.clipboard?.writeText(this.supportEmail).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
      },
      () => {},
    );
  }

  async signOut() {
    await this.supabase.signOut();
    this.toast.info('Đã đăng xuất.');
    this.router.navigate(['/']);
  }
}
