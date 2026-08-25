import { Injectable, signal } from '@angular/core';

export type DialogVariant = 'confirm' | 'warning' | 'destructive' | 'information';

export interface DialogOptions {
  variant: DialogVariant;
  title: string;
  description?: string;
  /** Nội dung nút chính phải là hành động rõ ràng, ví dụ "Xóa bộ sưu tập" —
   * không dùng nhãn chung chung như "OK". */
  confirmLabel: string;
  /** Bỏ trống để ẩn nút phụ (dùng cho dialog chỉ có 1 nút, ví dụ thông báo
   * kiểu "information" chỉ cần "Đã hiểu"). */
  cancelLabel?: string;
  /** Nếu được cung cấp, dialog tự chờ Promise này khi bấm nút chính — hiện
   * trạng thái loading (khóa nút, chặn Escape/backdrop) và chỉ đóng khi
   * thành công. Nếu ném lỗi, dialog vẫn mở và hiện lỗi ngay trong dialog. */
  onConfirm?: () => Promise<void>;
}

export interface ActiveDialog extends DialogOptions {
  id: number;
  loading: boolean;
  error: string | null;
}

interface QueuedDialog extends ActiveDialog {
  resolve: (value: boolean) => void;
}

/** App-wide confirm/warning/destructive/information dialog — replaces
 * window.confirm() for decisions that need a clear yes/no or acknowledgement.
 * Mounted once via <app-dialog-host> at the app root. Only one dialog is
 * shown at a time; additional calls queue rather than stacking backdrops. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private idCounter = 0;
  private queue = signal<QueuedDialog[]>([]);
  readonly current = signal<ActiveDialog | null>(null);

  private syncCurrent(): void {
    const [first] = this.queue();
    this.current.set(first ?? null);
  }

  confirm(options: DialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const id = ++this.idCounter;
      const entry: QueuedDialog = { ...options, id, loading: false, error: null, resolve };
      this.queue.update((list) => [...list, entry]);
      this.syncCurrent();
    });
  }

  private updateActive(patch: Partial<QueuedDialog>): void {
    this.queue.update((list) => list.map((d, i) => (i === 0 ? { ...d, ...patch } : d)));
    this.syncCurrent();
  }

  private popAndResolve(value: boolean): void {
    const [first, ...rest] = this.queue();
    if (!first) return;
    this.queue.set(rest);
    this.syncCurrent();
    first.resolve(value);
  }

  async confirmClicked(): Promise<void> {
    const dialog = this.queue()[0];
    if (!dialog || dialog.loading) return;

    if (!dialog.onConfirm) {
      this.popAndResolve(true);
      return;
    }

    this.updateActive({ loading: true, error: null });
    try {
      await dialog.onConfirm();
      this.popAndResolve(true);
    } catch (error) {
      this.updateActive({
        loading: false,
        error: error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.',
      });
    }
  }

  cancelClicked(): void {
    const dialog = this.queue()[0];
    if (!dialog || dialog.loading) return;
    this.popAndResolve(false);
  }

  /** Backdrop click / Escape — same as cancel, but silently ignored while a
   * required (loading) operation is in flight. */
  dismissRequested(): void {
    const dialog = this.queue()[0];
    if (!dialog || dialog.loading) return;
    this.popAndResolve(false);
  }
}
