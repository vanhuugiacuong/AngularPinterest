import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogService } from '../../core/services/dialog';
import { DialogHost } from './dialog-host';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('DialogHost', () => {
  let dialogService: DialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DialogHost] });
    dialogService = TestBed.inject(DialogService);
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders nothing when there is no active dialog', () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.nf-dialog-backdrop')).toBeNull();
  });

  it('renders role="alertdialog" for destructive dialogs with the aria wiring in place', () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();

    dialogService.confirm({
      variant: 'destructive',
      title: 'Xóa bộ sưu tập?',
      description: 'Không thể hoàn tác.',
      confirmLabel: 'Xóa bộ sưu tập',
      cancelLabel: 'Hủy',
    });
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.nf-dialog-panel') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('alertdialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe('nf-dialog-title');
    expect(panel.getAttribute('aria-describedby')).toBe('nf-dialog-description');
  });

  it('renders role="dialog" for a plain confirm/information dialog', () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();

    dialogService.confirm({ variant: 'information', title: 'Đã kích hoạt gói Pro', confirmLabel: 'Tuyệt vời' });
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.nf-dialog-panel') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('dialog');
  });

  it('locks body scroll while a dialog is open and restores it once it closes', async () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('');

    const result = dialogService.confirm({
      variant: 'confirm',
      title: 'Tiếp tục?',
      confirmLabel: 'Tiếp tục',
      cancelLabel: 'Hủy',
    });
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');

    dialogService.cancelClicked();
    await result;
    fixture.detectChanges();

    expect(document.body.style.overflow).toBe('');
  });

  it('moves focus into the panel on open and restores it to the trigger on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();

    const result = dialogService.confirm({
      variant: 'confirm',
      title: 'Tiếp tục?',
      confirmLabel: 'Tiếp tục',
      cancelLabel: 'Hủy',
    });
    fixture.detectChanges();
    await tick();

    const panel = fixture.nativeElement.querySelector('.nf-dialog-panel') as HTMLElement;
    expect(document.activeElement).toBe(panel);

    dialogService.cancelClicked();
    await result;
    fixture.detectChanges();
    await tick();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('resolves false and closes when Escape is pressed', async () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();

    const result = dialogService.confirm({
      variant: 'confirm',
      title: 'Tiếp tục?',
      confirmLabel: 'Tiếp tục',
      cancelLabel: 'Hủy',
    });
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    await expect(result).resolves.toBe(false);
  });

  it('closes on backdrop click but ignores clicks inside the panel', async () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();

    const result = dialogService.confirm({
      variant: 'confirm',
      title: 'Tiếp tục?',
      confirmLabel: 'Tiếp tục',
      cancelLabel: 'Hủy',
    });
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.nf-dialog-panel') as HTMLElement;
    panel.click();
    fixture.detectChanges();
    expect(dialogService.current()).not.toBeNull();

    const backdrop = fixture.nativeElement.querySelector('.nf-dialog-backdrop') as HTMLElement;
    backdrop.click();

    await expect(result).resolves.toBe(false);
  });

  it('traps Tab focus so it cycles between the first and last buttons in the panel', () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();

    dialogService.confirm({
      variant: 'confirm',
      title: 'Tiếp tục?',
      confirmLabel: 'Tiếp tục',
      cancelLabel: 'Hủy',
    });
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.nf-dialog-btn'),
    ) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    const [cancelBtn, confirmBtn] = buttons;

    confirmBtn.focus();
    expect(document.activeElement).toBe(confirmBtn);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(cancelBtn);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(confirmBtn);
  });

  it('disables the confirm/cancel buttons and shows the spinner while loading', async () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();

    let releaseConfirm!: () => void;
    dialogService.confirm({
      variant: 'destructive',
      title: 'Chặn người dùng?',
      confirmLabel: 'Chặn người dùng',
      cancelLabel: 'Hủy',
      onConfirm: () => new Promise<void>((resolve) => (releaseConfirm = resolve)),
    });
    fixture.detectChanges();

    const confirmClick = dialogService.confirmClicked();
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.nf-dialog-btn'),
    ) as HTMLButtonElement[];
    expect(buttons.every((btn) => btn.disabled)).toBe(true);
    expect(fixture.nativeElement.querySelector('.nf-dialog-spinner')).toBeTruthy();

    releaseConfirm();
    await confirmClick;
    fixture.detectChanges();

    expect(dialogService.current()).toBeNull();
  });
});
