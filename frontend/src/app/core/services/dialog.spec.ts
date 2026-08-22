import { describe, expect, it, vi } from 'vitest';
import { DialogService } from './dialog';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('DialogService', () => {
  it('resolves true when the confirm button is clicked and there is no onConfirm', async () => {
    const service = new DialogService();

    const result = service.confirm({
      variant: 'destructive',
      title: 'Xóa bộ sưu tập?',
      confirmLabel: 'Xóa bộ sưu tập',
      cancelLabel: 'Hủy',
    });
    expect(service.current()?.title).toBe('Xóa bộ sưu tập?');

    await service.confirmClicked();

    await expect(result).resolves.toBe(true);
    expect(service.current()).toBeNull();
  });

  it('resolves false when the cancel button is clicked', async () => {
    const service = new DialogService();

    const result = service.confirm({
      variant: 'warning',
      title: 'Bạn có chỉnh sửa chưa lưu',
      confirmLabel: 'Tiếp tục, bỏ chỉnh sửa',
      cancelLabel: 'Hủy',
    });

    service.cancelClicked();

    await expect(result).resolves.toBe(false);
    expect(service.current()).toBeNull();
  });

  it('resolves false on backdrop/Escape dismissal', async () => {
    const service = new DialogService();

    const result = service.confirm({
      variant: 'information',
      title: 'Đã kích hoạt gói Pro',
      confirmLabel: 'Tuyệt vời',
    });

    service.dismissRequested();

    await expect(result).resolves.toBe(false);
  });

  it('queues a second confirm() instead of overlapping the first dialog', async () => {
    const service = new DialogService();

    const first = service.confirm({ variant: 'confirm', title: 'Đầu tiên', confirmLabel: 'OK' });
    const second = service.confirm({ variant: 'confirm', title: 'Thứ hai', confirmLabel: 'OK' });

    expect(service.current()?.title).toBe('Đầu tiên');

    service.cancelClicked();
    await expect(first).resolves.toBe(false);
    expect(service.current()?.title).toBe('Thứ hai');

    service.cancelClicked();
    await expect(second).resolves.toBe(false);
    expect(service.current()).toBeNull();
  });

  it('shows a loading state while onConfirm runs and blocks cancel/dismiss during it', async () => {
    const service = new DialogService();
    const { promise: confirmPromise, resolve: resolveConfirm } = deferred<void>();
    const onConfirm = vi.fn().mockReturnValue(confirmPromise);

    const result = service.confirm({
      variant: 'destructive',
      title: 'Chặn người dùng?',
      confirmLabel: 'Chặn người dùng',
      cancelLabel: 'Hủy',
      onConfirm,
    });

    const clickPromise = service.confirmClicked();
    expect(service.current()?.loading).toBe(true);

    // Cancel/dismiss must be no-ops while a required operation is in flight.
    service.cancelClicked();
    service.dismissRequested();
    expect(service.current()?.loading).toBe(true);

    resolveConfirm();
    await clickPromise;

    await expect(result).resolves.toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(service.current()).toBeNull();
  });

  it('keeps the dialog open and surfaces the error message when onConfirm rejects', async () => {
    const service = new DialogService();
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('Không thể chặn người dùng.'));

    const result = service.confirm({
      variant: 'destructive',
      title: 'Chặn người dùng?',
      confirmLabel: 'Chặn người dùng',
      cancelLabel: 'Hủy',
      onConfirm,
    });

    await service.confirmClicked();

    expect(service.current()).not.toBeNull();
    expect(service.current()?.loading).toBe(false);
    expect(service.current()?.error).toBe('Không thể chặn người dùng.');

    // Retrying after the error succeeds and resolves the original promise.
    onConfirm.mockResolvedValueOnce(undefined);
    await service.confirmClicked();

    await expect(result).resolves.toBe(true);
    expect(service.current()).toBeNull();
  });

  it('ignores confirmClicked/cancelClicked when there is no active dialog', async () => {
    const service = new DialogService();

    await expect(service.confirmClicked()).resolves.toBeUndefined();
    expect(() => service.cancelClicked()).not.toThrow();
    expect(service.current()).toBeNull();
  });
});
