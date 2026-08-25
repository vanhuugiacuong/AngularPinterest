import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../core/services/toast';
import { ToastHost } from './toast-host';

describe('ToastHost', () => {
  let toastService: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ imports: [ToastHost] });
    toastService = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an active toast with role="status"/aria-live="polite" for success', () => {
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
    toastService.success('Đã lưu vào bộ sưu tập');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.nf-toast') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.textContent).toContain('Đã lưu vào bộ sưu tập');
  });

  it('renders role="alert"/aria-live="assertive" for error toasts', () => {
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
    toastService.error('Không thể lưu ảnh vào bộ sưu tập.');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.nf-toast') as HTMLElement;
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
  });

  it('auto-dismisses a toast once its duration elapses', () => {
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
    toastService.success('Tạm biệt', { duration: 4000 });
    fixture.detectChanges();

    expect(toastService.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(4000);

    expect(toastService.toasts()).toHaveLength(0);
  });

  it('pauses the countdown on hover and resumes with only the remaining time left', () => {
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
    const id = toastService.success('Đang chờ', { duration: 4000 });
    fixture.detectChanges();

    const component = fixture.componentInstance;
    vi.advanceTimersByTime(3000); // 1000ms remaining
    component.pause(id);
    vi.advanceTimersByTime(5000); // would have fired long ago if not paused
    expect(toastService.toasts()).toHaveLength(1);

    component.resume(id);
    vi.advanceTimersByTime(999);
    expect(toastService.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toastService.toasts()).toHaveLength(0);
  });

  it('closes a toast immediately when the close button is clicked', () => {
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
    toastService.success('Đóng ngay');
    fixture.detectChanges();

    const closeBtn = fixture.nativeElement.querySelector('.nf-toast__close') as HTMLButtonElement;
    closeBtn.click();
    fixture.detectChanges();

    expect(toastService.toasts()).toHaveLength(0);
  });

  it('runs the action callback and then closes the toast', () => {
    const onClick = vi.fn();
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
    toastService.error('Không thể lưu ảnh vào bộ sưu tập.', { action: { label: 'Thử lại', onClick } });
    fixture.detectChanges();

    const actionBtn = fixture.nativeElement.querySelector('.nf-toast__action') as HTMLButtonElement;
    expect(actionBtn.textContent).toContain('Thử lại');
    actionBtn.click();
    fixture.detectChanges();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(toastService.toasts()).toHaveLength(0);
  });

  it('does not stack a second identical toast (ToastService-level dedup reflected in the DOM)', () => {
    const fixture = TestBed.createComponent(ToastHost);
    fixture.detectChanges();
    toastService.success('Đã lưu vào bộ sưu tập');
    toastService.success('Đã lưu vào bộ sưu tập');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.nf-toast')).toHaveLength(1);
  });
});
