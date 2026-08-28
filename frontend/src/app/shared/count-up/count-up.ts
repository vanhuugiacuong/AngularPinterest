import { Component, Input, OnChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Slot {
  /** Chữ số đích (0-9), hoặc null nếu đây là ký tự tĩnh (dấu chấm, đ, %...). */
  digit: number | null;
  /** Ký tự tĩnh khi digit = null. */
  text: string;
  /** Vị trí cuối của băng số, tính theo số ô phải trượt lên. */
  index: number;
  /** Độ trễ khởi động, để các chữ số dừng lệch nhau như máy quay số. */
  delayMs: number;
}

/**
 * Số quay như máy đếm cơ / máy slot.
 *
 * Mỗi chữ số là một băng dọc 0-9 lặp lại nhiều vòng; băng trượt lên rồi hãm dần
 * để dừng đúng chữ số cần hiện. Chữ số bên PHẢI quay lâu hơn bên trái (delay
 * tăng dần) — đó là thứ tạo cảm giác "quay số" thật, nếu tất cả cùng dừng một
 * lúc thì chỉ như số nhảy một cái.
 *
 * Nhận thẳng CHUỖI đã định dạng (vd "277.000₫") chứ không nhận số thô, để dấu
 * phân cách nghìn và ký hiệu tiền tệ giữ nguyên vị trí — chỉ chữ số mới quay.
 */
@Component({
  selector: 'app-count-up',
  standalone: true,
  imports: [CommonModule],
  template: `<span class="cu" [style.--cu-dur.ms]="durationMs">@for (s of slots(); track $index) {
      @if (s.digit === null) {
        <span class="cu-static">{{ s.text }}</span>
      } @else {
        <span class="cu-slot"
          ><span class="cu-reel" [style.transform]="'translateY(-' + s.index + 'em)'" [style.transition-delay.ms]="s.delayMs"
            >@for (d of reel; track $index) {<span class="cu-d">{{ d }}</span>}</span
          ></span
        >
      }
    }</span>`,
  styles: [
    `
      :host {
        display: inline-block;
      }
      /* Canh theo ĐÁY hộp, không theo baseline: .cu-slot có overflow:hidden nên
         baseline cua no bi tong hop tu me duoi hop, lech han so voi baseline chu
         cua dau "." va ký hiệu "₫" ben canh. Cho ca hai cung chieu cao 1em roi
         canh flex-end thi hai ben nam dung mot duong. */
      .cu {
        display: inline-flex;
        align-items: flex-end;
        font-variant-numeric: tabular-nums;
      }
      .cu-static {
        display: inline-block;
        height: 1em;
        line-height: 1;
      }
      /* Khung nhìn cao đúng 1 dòng, phần băng thừa bị cắt -> chỉ thấy 1 chữ số */
      .cu-slot {
        display: inline-block;
        height: 1em;
        line-height: 1;
        overflow: hidden;
        vertical-align: bottom;
      }
      .cu-reel {
        display: flex;
        flex-direction: column;
        will-change: transform;
        transition: transform var(--cu-dur, 1900ms) cubic-bezier(0.16, 1, 0.3, 1);
      }
      .cu-d {
        height: 1em;
        line-height: 1;
      }
      /* Tôn trọng cài đặt giảm chuyển động của hệ điều hành: hiện thẳng số cuối. */
      @media (prefers-reduced-motion: reduce) {
        .cu-reel {
          transition: none;
        }
      }
    `,
  ],
})
export class CountUp implements OnChanges {
  /** Chuỗi ĐÃ định dạng sẵn, vd "277.000₫" hoặc "1385". */
  @Input({ required: true }) value = '';
  /** Số vòng quay trước khi dừng — càng nhiều càng "máy slot". */
  @Input() spins = 3;
  /** Thời gian quay của chữ số đầu tiên (ms). */
  @Input() durationMs = 1900;
  /** Mỗi chữ số kế tiếp trễ thêm bấy nhiêu ms, tạo hiệu ứng dừng lần lượt. */
  @Input() staggerMs = 130;

  /** Băng số: 0-9 lặp (spins + 1) vòng. */
  public reel: number[] = [];
  public slots = signal<Slot[]>([]);

  ngOnChanges() {
    const cycles = Math.max(1, this.spins) + 1;
    this.reel = Array.from({ length: cycles * 10 }, (_, i) => i % 10);

    const chars = [...(this.value ?? '')];
    let digitPos = 0;
    const next: Slot[] = chars.map((c) => {
      if (c < '0' || c > '9') return { digit: null, text: c, index: 0, delayMs: 0 };
      const d = Number(c);
      const slot: Slot = {
        digit: d,
        text: c,
        // Vị trí cuối = quay hết `spins` vòng rồi dừng ở chữ số đích.
        index: (cycles - 1) * 10 + d,
        delayMs: digitPos * this.staggerMs,
      };
      digitPos++;
      return slot;
    });

    // Đặt về 0 một nhịp rồi mới gán vị trí đích, nếu không trình duyệt gộp hai
    // lần thay đổi transform làm một và không có gì để chuyển tiếp -> không quay.
    this.slots.set(next.map((s) => ({ ...s, index: 0 })));
    requestAnimationFrame(() => requestAnimationFrame(() => this.slots.set(next)));
  }
}
