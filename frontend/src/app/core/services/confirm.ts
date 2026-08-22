import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (value: boolean) => void;
}

@Injectable({
  providedIn: 'root'
})
export class ConfirmService {
  public current = signal<PendingConfirm | null>(null);

  ask(message: string, options?: Partial<Omit<ConfirmRequest, 'message'>>): Promise<boolean> {
    return new Promise((resolve) => {
      this.current.set({
        title: options?.title ?? 'Xác nhận',
        message,
        confirmLabel: options?.confirmLabel ?? 'Xác nhận',
        cancelLabel: options?.cancelLabel ?? 'Hủy',
        danger: options?.danger ?? false,
        resolve
      });
    });
  }

  respond(value: boolean) {
    const pending = this.current();
    if (!pending) return;
    this.current.set(null);
    pending.resolve(value);
  }
}
