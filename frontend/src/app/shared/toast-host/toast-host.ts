import { Component, OnDestroy, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Toast, ToastService } from '../../core/services/toast';

interface TimerEntry {
  handle: ReturnType<typeof setTimeout>;
  remaining: number;
  startedAt: number;
}

/** Renders every active Toast and owns their auto-dismiss timers (including
 * pause-on-hover/focus) — mount exactly once at the app root. The service
 * only holds state; all timing lives here so it can react to real DOM
 * hover/focus events. */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-host.html',
  styleUrl: './toast-host.css',
})
export class ToastHost implements OnDestroy {
  toastService = inject(ToastService);
  private timers = new Map<number, TimerEntry>();

  topRightToasts = computed(() => this.toastService.toasts().filter((t) => t.corner !== 'bottom-left'));
  bottomLeftToasts = computed(() => this.toastService.toasts().filter((t) => t.corner === 'bottom-left'));

  constructor() {
    effect(() => {
      const current = this.toastService.toasts();
      const currentIds = new Set(current.map((t) => t.id));

      for (const toast of current) {
        if (!this.timers.has(toast.id)) {
          this.startTimer(toast);
        }
      }
      for (const id of Array.from(this.timers.keys())) {
        if (!currentIds.has(id)) {
          clearTimeout(this.timers.get(id)!.handle);
          this.timers.delete(id);
        }
      }
    });
  }

  private startTimer(toast: Toast): void {
    const startedAt = Date.now();
    const handle = setTimeout(() => this.toastService.dismiss(toast.id), toast.duration);
    this.timers.set(toast.id, { handle, remaining: toast.duration, startedAt });
  }

  pause(id: number): void {
    const entry = this.timers.get(id);
    if (!entry) return;
    clearTimeout(entry.handle);
    entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
  }

  resume(id: number): void {
    const entry = this.timers.get(id);
    if (!entry) return;
    entry.startedAt = Date.now();
    entry.handle = setTimeout(() => this.toastService.dismiss(id), entry.remaining);
  }

  close(id: number): void {
    this.toastService.dismiss(id);
  }

  runAction(toast: Toast): void {
    toast.action?.onClick();
    this.close(toast.id);
  }

  iconFor(toast: Toast): string {
    if (toast.icon) return toast.icon;

    const msg = toast.message.toLowerCase();
    if (msg.includes('bộ sưu tập') || msg.includes('lưu') || msg.includes('album') || msg.includes('bảng')) {
      return 'bookmark';
    }
    if (msg.includes('thích') || msg.includes('tim') || msg.includes('like')) {
      return 'favorite';
    }
    if (msg.includes('liên kết') || msg.includes('link') || msg.includes('sao chép') || msg.includes('copy')) {
      return 'link';
    }
    if (msg.includes('tải') || msg.includes('download')) {
      return 'download';
    }
    if (msg.includes('tin nhắn') || msg.includes('message') || msg.includes('chat')) {
      return 'chat_bubble';
    }
    if (msg.includes('theo dõi') || msg.includes('follow')) {
      return 'person_add';
    }
    if (msg.includes('xóa') || msg.includes('hủy') || msg.includes('delete')) {
      return 'delete';
    }

    switch (toast.kind) {
      case 'success':
        return 'check_circle';
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      default:
        return 'info';
    }
  }

  ngOnDestroy(): void {
    this.timers.forEach((entry) => clearTimeout(entry.handle));
    this.timers.clear();
  }
}
