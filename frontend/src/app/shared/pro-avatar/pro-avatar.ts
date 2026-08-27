import { Component, Input, signal } from '@angular/core';

/**
 * Avatar có nhận diện thành viên Pro: viền hồng đặc + huy hiệu crown góc dưới.
 * Dùng chung mọi nơi hiển thị avatar (hồ sơ, tác giả pin, bình luận, chat...).
 *
 *   <app-pro-avatar [src]="u.avatarUrl" [isPro]="u.isPro" [size]="40" [alt]="u.username" />
 */
@Component({
  selector: 'app-pro-avatar',
  standalone: true,
  template: `
    <span class="pa-wrap" [style.width.px]="size" [style.height.px]="size">
      <img
        [src]="imgSrc()"
        [alt]="alt"
        class="pa-img"
        [class.pa-ring]="isPro && !isYearly"
        [class.pa-ring-chrome]="isPro && isYearly"
        (error)="onError()"
      />
      @if (isPro) {
        <span
          class="pa-crest"
          [class.pa-crest-chrome]="isYearly"
          [style.width.px]="crestSize"
          [style.height.px]="crestSize"
        >
          <span class="material-symbols-outlined pa-crest-icon" [style.font-size.px]="crestIcon">workspace_premium</span>
        </span>
      }
    </span>
  `,
  styles: [
    `
      :host { display: inline-block; line-height: 0; }
      .pa-wrap { position: relative; display: inline-block; }
      .pa-img {
        width: 100%;
        height: 100%;
        border-radius: 9999px;
        object-fit: cover;
        display: block;
        background: #221b28;
      }
      /* Viền hồng đặc (có khe nền tối).
         Vẽ BÊN TRONG kích thước avatar bằng border + background thay vì
         box-shadow tràn ra ngoài: nhiều nơi đặt avatar trong vùng cuộn
         (overflow-y:auto) — thứ gì tràn khỏi khung đều bị cắt, khiến viền
         trông như bị "cắn" mất một bên. */
      .pa-ring {
        border: 2px solid #f94083;
        outline: 2px solid #121212;
        outline-offset: -2px;
        box-sizing: border-box;
      }
      .pa-crest {
        position: absolute;
        right: 0;
        bottom: 0;
        border-radius: 9999px;
        background: #f94083;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        border: 2px solid #121212;
        box-shadow: 0 2px 6px rgba(249, 64, 131, 0.5);
      }
      .pa-crest-icon {
        font-variation-settings: 'FILL' 1, 'wght' 600;
        line-height: 1;
      }

      /* ── Cấp gói NĂM: chrome ánh cầu vồng thay cho hồng ────────────────────
         Cũng vẽ bên trong khung (border + outline lùi vào) để không bị vùng
         cuộn cắt mất, giống .pa-ring. */
      .pa-ring-chrome {
        border: 2px solid #cdd8ff;
        outline: 2px solid #121212;
        outline-offset: -2px;
        box-sizing: border-box;
        box-shadow: 0 0 10px -2px rgba(184, 198, 255, 0.75);
      }
      .pa-crest-chrome {
        background-image: linear-gradient(
          115deg,
          #e8f4ff 0%, #b8c6ff 16%, #d9b8ff 32%,
          #ffc2e8 48%, #ffe0b8 62%, #b8ffe4 78%,
          #c6d4ff 90%, #eaf4ff 100%
        );
        background-size: 220% 100%;
        color: #241d2b;
        border-color: #121212;
        box-shadow: 0 2px 8px rgba(184, 198, 255, 0.6);
        animation: pa-chrome-shift 7s ease-in-out infinite;
      }
      @keyframes pa-chrome-shift {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .pa-crest-chrome { animation: none; }
      }
    `,
  ],
})
export class ProAvatar {
  private _src = signal<string | null>(null);
  @Input() set src(v: string | null | undefined) {
    this._src.set(v || null);
  }
  @Input() isPro = false;
  /** Gói NĂM: viền + huy hiệu chrome ánh cầu vồng thay vì hồng. */
  @Input() isYearly = false;
  @Input() size = 40;
  @Input() alt = '';

  readonly fallback = 'https://api.dicebear.com/7.x/bottts/svg';

  imgSrc(): string {
    return this._src() || this.fallback;
  }
  get crestSize(): number {
    return Math.max(14, Math.round(this.size * 0.42));
  }
  get crestIcon(): number {
    return Math.round(this.crestSize * 0.66);
  }
  onError() {
    this._src.set(this.fallback);
  }
}
