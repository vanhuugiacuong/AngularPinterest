import { Component, ElementRef, HostListener, ViewChild, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService } from '../../core/services/dialog';

/** Renders the currently active DialogService dialog — mount exactly once at
 * the app root. Owns focus-trap, Escape, backdrop-click, body-scroll-lock,
 * and return-focus behavior so every confirm/warning/destructive/information
 * dialog in the app gets this for free without re-implementing it per feature. */
@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dialog-host.html',
  styleUrl: './dialog-host.css',
})
export class DialogHost {
  dialogService = inject(DialogService);

  @ViewChild('panel') panelRef?: ElementRef<HTMLElement>;

  private returnFocusTo?: HTMLElement;
  private previousBodyOverflow?: string;

  constructor() {
    effect(() => {
      const dialog = this.dialogService.current();
      if (dialog) {
        if (!this.returnFocusTo) {
          this.returnFocusTo = document.activeElement as HTMLElement;
          this.previousBodyOverflow = document.body.style.overflow;
          document.body.style.overflow = 'hidden';
        }
        setTimeout(() => this.panelRef?.nativeElement.focus());
      } else if (this.returnFocusTo) {
        document.body.style.overflow = this.previousBodyOverflow ?? '';
        const target = this.returnFocusTo;
        this.returnFocusTo = undefined;
        setTimeout(() => target.focus());
      }
    });
  }

  iconFor(variant: string): string {
    switch (variant) {
      case 'destructive':
        return 'delete_forever';
      case 'warning':
        return 'warning';
      case 'information':
        return 'info';
      default:
        return 'help';
    }
  }

  roleFor(variant: string): 'dialog' | 'alertdialog' {
    return variant === 'destructive' || variant === 'warning' ? 'alertdialog' : 'dialog';
  }

  /** Tracks where a press on the backdrop started. Dismissing must only
   * happen when BOTH the mousedown and the resulting click land on the
   * backdrop itself — checking the click alone isn't enough: dragging to
   * select the dialog's own description text and releasing outside the
   * panel gets that click retargeted by the browser to the nearest common
   * ancestor (this backdrop), since mousedown/mouseup landed on different
   * elements. Dismissal stays driven by `click`, not `mousedown` directly,
   * so it never interferes with the browser's own text-selection handling. */
  private backdropMouseDownTarget: EventTarget | null = null;

  onBackdropMouseDown(event: MouseEvent): void {
    this.backdropMouseDownTarget = event.target;
  }

  onBackdropClick(event: MouseEvent): void {
    const startedOnBackdrop = this.backdropMouseDownTarget === event.currentTarget;
    this.backdropMouseDownTarget = null;
    if (startedOnBackdrop && event.target === event.currentTarget) {
      this.dialogService.dismissRequested();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const dialog = this.dialogService.current();
    if (!dialog) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.dialogService.dismissRequested();
      return;
    }

    if (event.key === 'Tab') {
      const panel = this.panelRef?.nativeElement;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
}
