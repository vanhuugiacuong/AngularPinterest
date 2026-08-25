import { Component, inject } from '@angular/core';
import { ThemeService } from '../../core/services/theme';

let nextId = 0;

/**
 * Sun/moon theme switch — shared across the public landing header and the
 * authenticated app's Navbar (its visibility there is gated by
 * ThemeService.showQuickToggle, set on /settings). A simple two-state
 * control (checked = dark): touching it always commits an explicit
 * light/dark choice via ThemeService (same persistence/system-tracking
 * rules as the three-way picker on /settings, just entered from a binary
 * switch here).
 */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.css',
})
export class ThemeToggle {
  private readonly theme = inject(ThemeService);

  /** Unique per instance — this control can be mounted twice at once
   * (desktop header row + mobile sheet), and ids must not collide. */
  protected readonly inputId = `nf-theme-toggle-input-${nextId++}`;

  protected get isDark(): boolean {
    return this.theme.resolvedTheme() === 'dark';
  }

  onToggle(checked: boolean): void {
    this.theme.setTheme(checked ? 'dark' : 'light');
  }
}
