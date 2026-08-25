import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { Settings } from './settings';
import { ThemeService } from '../../core/services/theme';
import { SupabaseService } from '../../core/services/supabase';
import { Switch } from '../../shared/switch/switch';

/** Shallow-render Navbar away — this spec is about the theme picker, not the
 * navbar's own search/auth wiring (already covered elsewhere). */
@Component({ selector: 'app-navbar', template: '', standalone: true })
class NavbarStub {}

describe('Settings', () => {
  function setup(preference: 'system' | 'light' | 'dark' = 'system', showQuickToggle = true) {
    const setTheme = vi.fn();
    const setShowQuickToggle = vi.fn();
    const themeService = {
      preference: signal(preference),
      resolvedTheme: signal<'light' | 'dark'>(preference === 'dark' ? 'dark' : 'light'),
      showQuickToggle: signal(showQuickToggle),
      setTheme,
      setShowQuickToggle,
    };

    TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideRouter([]),
        { provide: ThemeService, useValue: themeService },
        { provide: SupabaseService, useValue: { user: () => null, dbUser: () => null, loading: () => false } },
      ],
    }).overrideComponent(Settings, { set: { imports: [CommonModule, NavbarStub, Switch] } });

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    return { fixture, themeService, setTheme, setShowQuickToggle };
  }

  it('renders exactly the three theme options', () => {
    const { fixture } = setup();
    const buttons = fixture.nativeElement.querySelectorAll('[data-testid="theme-option"]');
    expect(buttons.length).toBe(3);
    const labels = Array.from(buttons).map((b) => (b as HTMLElement).textContent);
    expect(labels.some((t) => t?.includes('Theo hệ thống'))).toBe(true);
    expect(labels.some((t) => t?.includes('Sáng'))).toBe(true);
    expect(labels.some((t) => t?.includes('Tối'))).toBe(true);
  });

  it('marks only the active preference with aria-pressed="true"', () => {
    const { fixture } = setup('dark');
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="theme-option"]'),
    );
    const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBe(1);
    expect(pressed[0].textContent).toContain('Tối');

    const others = buttons.filter((b) => b !== pressed[0]);
    expect(others.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('is a native <button> for every option, so it is reachable and activatable by keyboard with no extra wiring', () => {
    const { fixture } = setup();
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="theme-option"]'),
    );
    expect(buttons.length).toBe(3);
    expect(buttons.every((b) => b.tagName === 'BUTTON' && b.type === 'button')).toBe(true);
  });

  it('calls ThemeService.setTheme with the clicked option', () => {
    const { fixture, setTheme } = setup('system');
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="theme-option"]'),
    );
    const lightButton = buttons.find((b) => b.textContent?.includes('Sáng'));

    lightButton?.click();

    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it('reflects the resolved theme in the live status line', () => {
    const { fixture } = setup('light');
    expect(fixture.nativeElement.textContent).toContain('Sương Ngọc (sáng)');
  });

  it('reflects the quick-toggle visibility with aria-checked', () => {
    const { fixture } = setup('system', true);
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="quick-toggle-switch"]');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('calls ThemeService.setShowQuickToggle with the flipped value when clicked', () => {
    const { fixture, setShowQuickToggle } = setup('system', true);
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="quick-toggle-switch"]');

    toggle.click();

    expect(setShowQuickToggle).toHaveBeenCalledWith(false);
  });

  it('flips the other way when starting hidden', () => {
    const { fixture, setShowQuickToggle } = setup('system', false);
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="quick-toggle-switch"]');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    toggle.click();

    expect(setShowQuickToggle).toHaveBeenCalledWith(true);
  });
});
