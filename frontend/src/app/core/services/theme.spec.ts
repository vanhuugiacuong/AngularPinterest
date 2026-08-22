import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeService } from './theme';

function mockMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = initialMatches;
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: light)',
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };
  return {
    mql: mql as unknown as MediaQueryList,
    trigger: (next: boolean) => {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
    listenerCount: () => listeners.size,
  };
}

function colorSchemeOf(el: HTMLElement): string {
  return el.style.colorScheme || el.style.getPropertyValue('color-scheme');
}

describe('ThemeService', () => {
  let store: Record<string, string>;
  // window.matchMedia is reassigned (not spied) below, so vi.restoreAllMocks()
  // cannot undo it — without this, the mock leaks into every spec file that
  // runs afterward in the same Vitest worker.
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    store = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => store[key] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      store[key] = value;
    });
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    window.matchMedia = originalMatchMedia;
  });

  it('defaults preference to system when nothing was previously saved', () => {
    const { mql } = mockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const service = TestBed.inject(ThemeService);

    expect(service.preference()).toBe('system');
    expect(service.resolvedTheme()).toBe('light');
  });

  it('reads a previously saved preference from localStorage on init', () => {
    store['novaframe:theme'] = 'dark';
    const { mql } = mockMatchMedia(true); // system prefers light, saved choice should win
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const service = TestBed.inject(ThemeService);

    expect(service.preference()).toBe('dark');
    expect(service.resolvedTheme()).toBe('dark');
  });

  it('switches between light, dark, and system, resolving each correctly', () => {
    const { mql } = mockMatchMedia(false); // system prefers dark
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const service = TestBed.inject(ThemeService);

    service.setTheme('light');
    expect(service.preference()).toBe('light');
    expect(service.resolvedTheme()).toBe('light');

    service.setTheme('dark');
    expect(service.preference()).toBe('dark');
    expect(service.resolvedTheme()).toBe('dark');

    service.setTheme('system');
    expect(service.preference()).toBe('system');
    expect(service.resolvedTheme()).toBe('dark');
  });

  it('tracks prefers-color-scheme changes only while preference is system', () => {
    const { mql, trigger, listenerCount } = mockMatchMedia(false);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const service = TestBed.inject(ThemeService);
    expect(listenerCount()).toBe(1);
    expect(service.resolvedTheme()).toBe('dark');

    trigger(true);
    expect(service.resolvedTheme()).toBe('light');

    service.setTheme('dark');
    expect(listenerCount()).toBe(0); // stops listening once the user picks a theme manually

    trigger(false); // OS flips back — must not affect the forced choice
    expect(service.resolvedTheme()).toBe('dark');

    service.setTheme('system');
    expect(listenerCount()).toBe(1);
  });

  it('persists the chosen preference to localStorage', () => {
    const { mql } = mockMatchMedia(false);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const service = TestBed.inject(ThemeService);
    service.setTheme('light');

    expect(localStorage.setItem).toHaveBeenCalledWith('novaframe:theme', 'light');
    expect(store['novaframe:theme']).toBe('light');
  });

  it('applies data-theme and color-scheme to <html>', () => {
    const { mql } = mockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    TestBed.inject(ThemeService);
    TestBed.tick();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(colorSchemeOf(document.documentElement)).toBe('light');
  });

  it('defaults the quick-toggle visibility to true when nothing was saved', () => {
    const { mql } = mockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const service = TestBed.inject(ThemeService);

    expect(service.showQuickToggle()).toBe(true);
  });

  it('reads a previously saved quick-toggle preference from localStorage', () => {
    store['novaframe:quick-toggle'] = 'false';
    const { mql } = mockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const service = TestBed.inject(ThemeService);

    expect(service.showQuickToggle()).toBe(false);
  });

  it('persists a quick-toggle visibility change to localStorage', () => {
    const { mql } = mockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const service = TestBed.inject(ThemeService);
    service.setShowQuickToggle(false);

    expect(service.showQuickToggle()).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledWith('novaframe:quick-toggle', 'false');
    expect(store['novaframe:quick-toggle']).toBe('false');

    service.setShowQuickToggle(true);
    expect(service.showQuickToggle()).toBe(true);
    expect(store['novaframe:quick-toggle']).toBe('true');
  });
});
