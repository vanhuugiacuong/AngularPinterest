import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  duration: number;
}

export interface ToastOptions {
  action?: ToastAction;
  duration?: number;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 6000,
};

/** App-wide toast notifications — replaces window.alert() for transient
 * success/error/info feedback that does not require a user decision. Mounted
 * once via <app-toast-host> at the app root; call success()/error()/warning()/
 * info() from anywhere. See ToastHost for auto-dismiss/pause-on-hover timing. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private idCounter = 0;
  readonly toasts = signal<Toast[]>([]);

  show(kind: ToastKind, message: string, options: ToastOptions = {}): number {
    // Không hiển thị trùng nhiều toast giống nhau liên tục — nếu đã có toast
    // cùng loại + cùng nội dung đang hiển thị, bỏ qua thay vì chồng thêm.
    const duplicate = this.toasts().find((t) => t.kind === kind && t.message === message);
    if (duplicate) return duplicate.id;

    const id = ++this.idCounter;
    const duration = options.duration ?? DEFAULT_DURATION[kind];
    this.toasts.update((list) => [...list, { id, kind, message, action: options.action, duration }]);
    return id;
  }

  success(message: string, options?: ToastOptions): number {
    return this.show('success', message, options);
  }

  error(message: string, options?: ToastOptions): number {
    return this.show('error', message, options);
  }

  warning(message: string, options?: ToastOptions): number {
    return this.show('warning', message, options);
  }

  info(message: string, options?: ToastOptions): number {
    return this.show('info', message, options);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this.toasts.set([]);
  }
}
