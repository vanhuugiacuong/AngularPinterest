import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  public toasts = signal<Toast[]>([]);
  private seq = 0;
  private timers = new Map<number, any>();

  success(message: string, durationMs = 3500) {
    this.push('success', message, durationMs);
  }

  error(message: string, durationMs = 4500) {
    this.push('error', message, durationMs);
  }

  info(message: string, durationMs = 3500) {
    this.push('info', message, durationMs);
  }

  dismiss(id: number) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private push(kind: ToastKind, message: string, durationMs: number) {
    const id = ++this.seq;
    this.toasts.update((list) => [...list, { id, kind, message, durationMs }]);
    const timer = setTimeout(() => this.dismiss(id), durationMs);
    this.timers.set(id, timer);
  }
}
