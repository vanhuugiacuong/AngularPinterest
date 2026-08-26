import { Component, Input } from '@angular/core';

/**
 * Icon dùng cho các trang thương mại.
 * - `coin`  -> xu credit filled nhiều màu (token có sao) — giữ nguyên, đặc trưng.
 * - còn lại -> Material Symbols (đồng bộ với phần còn lại của app).
 *
 * Kích thước điều khiển bằng class w-* h-* như thường; glyph Material tự vừa hộp
 * nhờ container-query (font-size: 100cqmin). Màu theo currentColor (text-*).
 *
 *   <app-icon name="crown" class="w-6 h-6 text-[#B15CAA]" />
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    @if (name === 'coin') {
      <svg viewBox="0 0 24 24" fill="none" class="coin">
        <circle cx="12" cy="13" r="9" fill="#2f2150" />
        <circle cx="12" cy="11.4" r="9" fill="#c05fe0" />
        <circle cx="12" cy="11.4" r="6.5" fill="#3a2a5e" />
        <path d="M12 6.7l1.36 3.13 3.4.29-2.58 2.24.79 3.32L12 14.28l-2.97 1.71.79-3.32-2.58-2.24 3.4-.29L12 6.7Z" fill="#eaa8f5" />
        <path d="M12 6.7l1.36 3.13 3.4.29-2.58 2.24.79 3.32L12 14.28V6.7Z" fill="#d47ceb" />
        <path d="M17.7 4.6l.5 1.45 1.45.5-1.45.5-.5 1.45-.5-1.45-1.45-.5 1.45-.5.5-1.45Z" fill="#ffffff" />
      </svg>
    } @else {
      <span class="mi material-symbols-outlined">{{ mat }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 0;
        container-type: size;
      }
      .coin {
        width: 100%;
        height: 100%;
      }
      .mi {
        font-size: 100cqmin;
        line-height: 1;
        color: currentColor;
        user-select: none;
      }
    `,
  ],
})
export class Icon {
  @Input() name = '';

  private static readonly MAP: Record<string, string> = {
    crown: 'workspace_premium',
    spark: 'auto_awesome',
    hd: 'high_quality',
    lock: 'lock',
    download: 'download',
    infinity: 'all_inclusive',
    check: 'check_circle',
    x: 'cancel',
    clock: 'schedule',
    qr: 'qr_code_2',
    wallet: 'account_balance_wallet',
    receipt: 'receipt_long',
    'arrow-right': 'arrow_forward',
    shield: 'verified_user',
    sync: 'autorenew',
    bank: 'account_balance',
    copy: 'content_copy',
    plus: 'add',
  };

  get mat(): string {
    return Icon.MAP[this.name] ?? 'circle';
  }
}
