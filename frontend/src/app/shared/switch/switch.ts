import { Component, input, output } from '@angular/core';

/**
 * Shared on/off switch — the same `role="switch"` track+thumb markup that
 * used to be copy-pasted independently in Settings (quick-toggle, privacy)
 * and Board Detail (secret board). Presentational only: the caller still
 * owns the boolean state and the toggle handler, this just renders it and
 * emits `toggled` on click (never when disabled).
 */
@Component({
  selector: 'app-switch',
  standalone: true,
  templateUrl: './switch.html',
})
export class Switch {
  checked = input<boolean>(false);
  disabled = input<boolean>(false);
  ariaLabel = input<string | null>(null);
  ariaLabelledby = input<string | null>(null);
  testId = input<string | null>(null);

  toggled = output<void>();

  onClick(): void {
    if (this.disabled()) return;
    this.toggled.emit();
  }
}
