import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'novaframe:theme';
const QUICK_TOGGLE_STORAGE_KEY = 'novaframe:quick-toggle';
const SYSTEM_QUERY = '(prefers-color-scheme: light)';

/**
 * Signal-based theme controller. Persists the user's choice to localStorage,
 * resolves 'system' against prefers-color-scheme, and reflects the result as
 * data-theme + color-scheme on <html>. A matching inline script in
 * index.html applies the same resolution before Angular bootstraps, so this
 * service's first effect run is idempotent (no flash of the wrong theme).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly systemPrefersLight = signal(this.readSystemPreference());
  private mediaQuery: MediaQueryList | null = null;
  private readonly onSystemChange = (event: MediaQueryListEvent) => {
    this.systemPrefersLight.set(event.matches);
  };

  readonly preference = signal<ThemePreference>(this.readStoredPreference());

  /** Whether the sun/moon quick-toggle shows up in the Navbar (Landing
   * always shows its own copy — that one's reachable pre-login, so hiding
   * it there wouldn't make sense). Defaults to visible; set from /settings. */
  readonly showQuickToggle = signal<boolean>(this.readStoredQuickToggle());

  readonly resolvedTheme = computed<ResolvedTheme>(() => {
    const preference = this.preference();
    if (preference === 'light' || preference === 'dark') {
      return preference;
    }
    return this.systemPrefersLight() ? 'light' : 'dark';
  });

  constructor() {
    this.syncSystemListener(this.preference());

    effect(() => {
      const resolved = this.resolvedTheme();
      if (typeof document === 'undefined') return;
      document.documentElement.setAttribute('data-theme', resolved);
      document.documentElement.style.colorScheme = resolved;
    });
  }

  setTheme(preference: ThemePreference): void {
    this.preference.set(preference);
    this.syncSystemListener(preference);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Storage unavailable (private browsing, SSR) — in-memory state still applies.
    }
  }

  setShowQuickToggle(visible: boolean): void {
    this.showQuickToggle.set(visible);
    try {
      localStorage.setItem(QUICK_TOGGLE_STORAGE_KEY, visible ? 'true' : 'false');
    } catch {
      // Storage unavailable (private browsing, SSR) — in-memory state still applies.
    }
  }

  private readStoredPreference(): ThemePreference {
    try {
      const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // Storage unavailable — fall through to the default below.
    }
    return 'system';
  }

  private readStoredQuickToggle(): boolean {
    try {
      const stored =
        typeof localStorage === 'undefined' ? null : localStorage.getItem(QUICK_TOGGLE_STORAGE_KEY);
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch {
      // Storage unavailable — fall through to the default below.
    }
    return true;
  }

  private readSystemPreference(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(SYSTEM_QUERY).matches;
  }

  /** Only listens for OS theme changes while preference is 'system' — an
   * explicit light/dark choice must not be overridden by a later OS change. */
  private syncSystemListener(preference: ThemePreference): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    if (preference === 'system') {
      if (!this.mediaQuery) {
        this.mediaQuery = window.matchMedia(SYSTEM_QUERY);
        this.mediaQuery.addEventListener('change', this.onSystemChange);
      }
      return;
    }

    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.onSystemChange);
      this.mediaQuery = null;
    }
  }
}
