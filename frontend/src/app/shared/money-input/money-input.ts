import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

let nextId = 0;

/** Ô nhập số tiền VND dùng chung — gõ tới đâu định dạng dấu chấm ngăn cách
 * hàng nghìn tới đó, chỉ nhận chữ số (dán/gõ ký tự khác đều bị lọc bỏ ngay),
 * và tự kẹp về `max` khi vượt trần — không cho gõ vượt quá số tiền hợp lệ
 * lớn nhất hệ thống chấp nhận. Input/Output thường (không CVA) để khớp cách
 * shared/range-control đã làm — app này dùng template-driven forms
 * ([(ngModel)]) chứ không có ReactiveFormsModule ở đâu cả. */
@Component({
  selector: 'app-money-input',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './money-input.html',
  styleUrl: './money-input.css',
})
export class MoneyInput {
  public readonly inputId = `money-input-${nextId++}`;

  @Input() value: number | null = null;
  @Input() min = 0;
  @Input() max = 9_999_999_999;
  @Input() placeholder = '';
  @Input() disabled = false;
  @Input() suffix = 'đ';
  @Input() ariaLabel = 'Số tiền';

  @Output() valueChange = new EventEmitter<number | null>();

  protected displayValue = '';

  ngOnChanges(): void {
    this.displayValue = this.formatDigits(this.value === null ? '' : String(Math.trunc(this.value)));
  }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let digits = input.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');

    if (digits === '') {
      this.displayValue = '';
      input.value = '';
      this.value = null;
      this.valueChange.emit(null);
      return;
    }

    let numeric = Number(digits);
    if (numeric > this.max) {
      numeric = this.max;
      digits = String(numeric);
    }

    this.value = numeric;
    this.displayValue = this.formatDigits(digits);
    input.value = this.displayValue;
    this.valueChange.emit(numeric);
  }

  /** Chặn mọi phím không phải chữ số/điều hướng ngay từ gốc — lọc ở (input)
   * đã đủ đúng, nhưng chặn thêm ở keydown giúp không có ký tự lạ nào kịp
   * nháy lên màn hình dù chỉ một khung hình. */
  onKeydown(event: KeyboardEvent): void {
    const allowed = [
      'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Tab', 'Home', 'End', 'Enter', 'Escape',
    ];
    if (allowed.includes(event.key) || event.ctrlKey || event.metaKey) return;
    if (!/^\d$/.test(event.key)) event.preventDefault();
  }

  private formatDigits(digits: string): string {
    if (!digits) return '';
    return Number(digits).toLocaleString('vi-VN');
  }
}
