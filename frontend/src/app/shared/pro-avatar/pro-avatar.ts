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
        [class.pa-ring]="isPro"
        (error)="onError()"
      />
      @if (isPro) {
        <span class="pa-crest" [style.width.px]="crestSize" [style.height.px]="crestSize">
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
      /* Viền hồng đặc (có khe nền tối) */
      .pa-ring {
        box-shadow: 0 0 0 2px #0f0d13, 0 0 0 4px #f94083;
      }
      .pa-crest {
        position: absolute;
        right: -2px;
        bottom: -2px;
        border-radius: 9999px;
        background: #f94083;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        border: 2px solid #0f0d13;
        box-shadow: 0 2px 6px rgba(249, 64, 131, 0.5);
      }
      .pa-crest-icon {
        font-variation-settings: 'FILL' 1, 'wght' 600;
        line-height: 1;
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
