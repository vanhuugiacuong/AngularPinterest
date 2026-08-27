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
      /* Viền hồng đặc — vẽ bằng thuộc tính border nên nằm TRONG kích thước avatar.
         Không dùng box-shadow (toả ra ngoài, bị vùng overflow-y:auto cắt) và
         không thêm khe tối bên trong bằng outline offset âm (dễ chồng lên
         viền che mất nó, lại ăn lẹm vào ảnh làm avatar co lại). */
      .pa-ring {
        border: 2.5px solid #f94083;
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

      /* ── Cấp gói NĂM: viền chrome bạc thay cho hồng ────────────────────────
         Cùng cách vẽ như .pa-ring (một vòng border, không glow, không khe tối). */
      .pa-ring-chrome {
        border: 2.5px solid #dfe7ff;
        box-sizing: border-box;
      }
      /* Huy hiệu chỉ ~18px nên gradient phải VỪA KHÍT (100%), không phóng to:
         với background-size 220% trên vùng bé xíu, mỗi lúc chỉ lọt đúng một
         dải màu — huy hiệu trông lúc tím lúc hồng chứ không ra ánh kim.
         Ít điểm dừng hơn bản dùng cho chữ, để đọc được là "kim loại". */
      .pa-crest-chrome {
        background-image: linear-gradient(
          135deg,
          #ffffff 0%, #cfd9f0 28%, #9fb0d8 50%, #e6ecfa 72%, #b9c6e4 100%
        );
        background-size: 100% 100%;
        color: #1e2333;
        border-color: #121212;
        box-shadow: 0 2px 8px rgba(184, 198, 255, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.55);
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
