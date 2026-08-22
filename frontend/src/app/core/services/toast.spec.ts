import { describe, expect, it } from 'vitest';
import { ToastService } from './toast';

describe('ToastService', () => {
  it('adds a success toast with the default duration', () => {
    const service = new ToastService();

    const id = service.success('Đã lưu vào bộ sưu tập');

    expect(service.toasts()).toHaveLength(1);
    expect(service.toasts()[0]).toMatchObject({
      id,
      kind: 'success',
      message: 'Đã lưu vào bộ sưu tập',
      duration: 4000,
    });
  });

  it('uses a longer default duration for warning and error toasts', () => {
    const service = new ToastService();

    service.warning('Cảnh báo');
    service.error('Lỗi');

    expect(service.toasts()[0].duration).toBe(6000);
    expect(service.toasts()[1].duration).toBe(6000);
  });

  it('accepts a custom duration and an action', () => {
    const service = new ToastService();
    const onClick = () => {};

    service.error('Không thể lưu ảnh vào bộ sưu tập.', {
      duration: 9000,
      action: { label: 'Thử lại', onClick },
    });

    expect(service.toasts()[0]).toMatchObject({
      duration: 9000,
      action: { label: 'Thử lại', onClick },
    });
  });

  it('does not stack a duplicate toast of the same kind and message', () => {
    const service = new ToastService();

    const firstId = service.success('Đã lưu vào bộ sưu tập');
    const secondId = service.success('Đã lưu vào bộ sưu tập');

    expect(service.toasts()).toHaveLength(1);
    expect(secondId).toBe(firstId);
  });

  it('allows the same message again once a kind differs', () => {
    const service = new ToastService();

    service.success('Đã lưu vào bộ sưu tập');
    service.error('Đã lưu vào bộ sưu tập');

    expect(service.toasts()).toHaveLength(2);
  });

  it('dismisses a toast by id without touching the others', () => {
    const service = new ToastService();
    const keepId = service.success('Giữ lại');
    const dropId = service.error('Xóa đi');

    service.dismiss(dropId);

    expect(service.toasts().map((t) => t.id)).toEqual([keepId]);
  });

  it('clears every toast at once', () => {
    const service = new ToastService();
    service.success('A');
    service.warning('B');

    service.clear();

    expect(service.toasts()).toEqual([]);
  });
});
