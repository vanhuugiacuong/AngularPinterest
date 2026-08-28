import { Directive, ElementRef, HostListener, Input, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Ô nhập số tiền: chỉ chữ số, tự chấm phân cách nghìn, model vẫn là `number`.
 *
 * Vì sao KHÔNG dùng `type="number"` — đó chính là nguyên nhân ô giá hiện ra
 * `--`:
 *
 *   1. Trình duyệt cho phép gõ `e`, `E`, `+`, `-`, `.`, `,` vào input số (vì
 *      chúng hợp lệ trong ký hiệu khoa học và số thực). Khi chuỗi không parse
 *      được, `input.value` trả về CHUỖI RỖNG nhưng thứ đang hiện trên màn hình
 *      vẫn là mấy ký tự đó. Người dùng thấy `--`, Angular nhận `null`.
 *   2. Mũi tên tăng/giảm vô dụng với tiền Việt: `step="1000"` nghĩa là phải bấm
 *      500 lần để tới 500.000.
 *   3. Lăn chuột khi con trỏ nằm trên input số sẽ ÂM THẦM đổi giá trị.
 *   4. Không có phân cách nghìn, `500000` rất khó đọc so với `500.000`.
 *
 * Nên input là `type="text"` với `inputmode="numeric"` (bàn phím số trên di
 * động), lọc về chữ số, và định dạng lại bằng cùng Intl.NumberFormat mà
 * core/utils/currency.ts dùng để HIỂN THỊ tiền — nhập và xem khớp nhau.
 */
const GROUPER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

@Directive({
  selector: 'input[appCurrencyInput]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencyInputDirective),
      multi: true,
    },
  ],
  host: {
    // Bàn phím số trên di động mà không mang theo mấy phiền toái của type=number.
    inputmode: 'numeric',
    autocomplete: 'off',
    type: 'text',
  },
})
export class CurrencyInputDirective implements ControlValueAccessor {
  /** Số chữ số tối đa. 10 cho tới 9.999.999.999đ — quá đủ cho giá một tấm
   *  ảnh, và nó cũng chặn luôn hai chuyện: người dùng dán vào một con số dài vô
   *  nghĩa, và `number` của JS mất chính xác từ 16 chữ số trở lên
   *  (Number.MAX_SAFE_INTEGER), lúc đó giá gửi lên server sẽ không còn đúng
   *  thứ hiện trên màn hình. */
  @Input() maxDigits = 10;

  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: number | null): void {
    this.el.nativeElement.value =
      value === null || value === undefined || Number.isNaN(value) ? '' : GROUPER.format(value);
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.el.nativeElement.disabled = isDisabled;
  }

  /** Chặn ngay từ phím bấm để không thấy ký tự loé lên rồi biến mất. Không
   *  chặn phím điều hướng, xoá, hay tổ hợp Ctrl/Cmd (copy, dán, chọn hết). */
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length > 1) return; // Backspace, Tab, ArrowLeft, ...
    if (!/[0-9]$/.test(event.key)) {
      event.preventDefault();
      return;
    }
    // Đã đủ chữ số thì chặn ngay tại phím, để con số không loé lên rồi bị cắt.
    // Có vùng chọn thì cho gõ: ký tự mới thay thế phần đang chọn.
    const input = this.el.nativeElement;
    const hasSelection = (input.selectionEnd ?? 0) > (input.selectionStart ?? 0);
    const digits = (input.value.match(/\d/g) || []).length;
    if (!hasSelection && digits >= this.maxDigits) event.preventDefault();
  }

  @HostListener('input')
  onInput(): void {
    const input = this.el.nativeElement;
    // Đếm số CHỮ SỐ trước con trỏ, không phải vị trí ký tự: sau khi thêm/bớt
    // dấu chấm, vị trí ký tự cũ trỏ sai chỗ và con trỏ sẽ nhảy.
    const caret = input.selectionStart ?? input.value.length;
    const digitsBeforeCaret = (input.value.slice(0, caret).match(/\d/g) || []).length;

    // Cắt ở maxDigits, không phải chỉ chặn ở keydown: dán và tự động điền đi
    // thẳng vào đây mà không qua phím nào.
    const digits = input.value.replace(/\D/g, '').slice(0, this.maxDigits);
    const numeric = digits === '' ? null : Number(digits);

    input.value = numeric === null ? '' : GROUPER.format(numeric);
    this.onChange(numeric);

    let seen = 0;
    let position = input.value.length;
    for (let i = 0; i < input.value.length; i++) {
      if (/\d/.test(input.value[i])) seen++;
      if (seen === digitsBeforeCaret) {
        position = i + 1;
        break;
      }
    }
    if (digitsBeforeCaret === 0) position = 0;
    input.setSelectionRange(position, position);
  }

  /** Dán thì để `input` phía trên lo phần lọc — chỉ cần chặn hành vi mặc định
   *  khi nội dung dán không có chữ số nào, để không xoá mất thứ đang có. */
  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!/\d/.test(text)) event.preventDefault();
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
  }
}
