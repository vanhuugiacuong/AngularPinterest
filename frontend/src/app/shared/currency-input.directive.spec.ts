import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrencyInputDirective } from './currency-input.directive';

@Component({
  standalone: true,
  imports: [FormsModule, CurrencyInputDirective],
  template: `<input appCurrencyInput [(ngModel)]="price" />`,
})
class HostComponent {
  price: number | null = null;
}

describe('CurrencyInputDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let input: HTMLInputElement;

  /** Gõ như người dùng: đặt giá trị thô rồi phát sự kiện `input`, đúng thứ
   *  trình duyệt làm. */
  function type(raw: string, caretAtEnd = true) {
    input.value = raw;
    if (caretAtEnd) input.setSelectionRange(raw.length, raw.length);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    input = fixture.nativeElement.querySelector('input');
  });

  it('is a text input with a numeric keypad, not type=number', () => {
    // type=number is the whole reason the field could show "--": the browser
    // accepts e/+/-/. and then reports an empty value.
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('numeric');
  });

  it('groups thousands as it is typed and keeps the model numeric', () => {
    type('500000');
    expect(input.value).toBe('500.000');
    expect(fixture.componentInstance.price).toBe(500000);
  });

  it('strips the characters that made the field show "--"', () => {
    type('--');
    expect(input.value).toBe('');
    expect(fixture.componentInstance.price).toBeNull();

    type('1e5');
    expect(input.value).toBe('15');
    expect(fixture.componentInstance.price).toBe(15);

    type('1.000,50đ');
    expect(input.value).toBe('100.050');
    expect(fixture.componentInstance.price).toBe(100050);
  });

  it('blocks a non-digit keystroke but lets editing keys through', () => {
    const blocked = new KeyboardEvent('keydown', { key: '-', cancelable: true });
    input.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    for (const key of ['Backspace', 'ArrowLeft', 'Tab', '7']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(false);
    }
  });

  it('allows Ctrl/Cmd combinations so copy and paste still work', () => {
    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('writes a model value back out formatted', async () => {
    // await whenStable, khong chi detectChanges: ngModel day gia tri xuong view
    // qua microtask, nen mot vong CD chua flush kip.
    fixture.componentInstance.price = 1234567;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(input.value).toBe('1.234.567');

    fixture.componentInstance.price = null;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(input.value).toBe('');
  });

  it('caps at 10 digits, however the value arrives', () => {
    // Gõ / dán quá dài: cắt ở 10 chữ số, không im lặng nhận cả chuỗi.
    type('5000000000000000000000');
    expect(input.value).toBe('5.000.000.000');
    expect(fixture.componentInstance.price).toBe(5000000000);
    // Vẫn nằm trong vùng an toàn của Number, nên giá gửi lên server đúng thứ
    // đang hiện.
    expect(Number.isSafeInteger(fixture.componentInstance.price!)).toBe(true);
  });

  it('blocks an 11th digit at the keystroke, but allows it when text is selected', () => {
    type('1234567890');
    expect(input.value).toBe('1.234.567.890');

    const blocked = new KeyboardEvent('keydown', { key: '9', cancelable: true });
    input.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    // Có vùng chọn thì ký tự mới THAY THẾ phần đang chọn, không làm dài thêm.
    input.setSelectionRange(0, input.value.length);
    const allowed = new KeyboardEvent('keydown', { key: '9', cancelable: true });
    input.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });

  it('honours a custom maxDigits', () => {
    const directive = fixture.debugElement
      .query((node) => node.nativeElement === input)
      .injector.get(CurrencyInputDirective);
    directive.maxDigits = 4;
    type('123456');
    expect(input.value).toBe('1.234');
  });

  it('keeps the caret next to the same digit after a separator appears', () => {
    // "1000" -> "1.000": a separator is inserted before the caret, so a naive
    // implementation that restores the old character index lands one digit off.
    type('1000');
    expect(input.value).toBe('1.000');
    expect(input.selectionStart).toBe(5);

    // Editing in the middle: caret sits after the 2nd digit of "12345".
    input.value = '12345';
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(input.value).toBe('12.345');
    const before = (input.value.slice(0, input.selectionStart ?? 0).match(/\d/g) || []).length;
    expect(before).toBe(2);
  });
});
