import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingService } from '../../core/services/messaging';
import { NotificationService } from '../../core/services/notification';
import { SidebarStateService } from '../../core/services/sidebar-state';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { UserService } from '../../core/services/user';
import { Sidebar } from './sidebar';

describe('Sidebar click-only behavior', () => {
  let component: Sidebar;
  let state: SidebarStateService;
  const navigate = vi.fn();
  const loadNotifications = vi.fn();

  beforeEach(() => {
    navigate.mockReset();
    loadNotifications.mockReset();
    TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        SidebarStateService,
        {
          provide: NotificationService,
          useValue: {
            unreadCount$: of(0),
            notifications$: of([]),
            loadNotifications,
            markAllAsRead: vi.fn(() => of({})),
            markAsRead: vi.fn(() => of({})),
          },
        },
        { provide: MessagingService, useValue: { unreadCount$: of(0) } },
        { provide: UserService, useValue: {} },
        {
          provide: SupabaseService,
          useValue: {
            user: vi.fn(() => ({ email: 'tai@example.com', user_metadata: {} })),
            dbUser: vi.fn(() => ({ username: 'tai', displayName: 'Tài', avatarUrl: null, plan: 'FREE' })),
          },
        },
        { provide: ToastService, useValue: {} },
        { provide: Router, useValue: { url: '/feed', navigate } },
      ],
    });

    state = TestBed.inject(SidebarStateService);
    component = TestBed.runInInjectionContext(() => new Sidebar());
  });

  afterEach(() => TestBed.resetTestingModule());

  it('expands when the compact rail blank area is clicked', () => {
    const blankArea = document.createElement('div');
    component.onRailClick({ target: blankArea } as unknown as MouseEvent);

    expect(state.isExpanded()).toBe(true);
  });

  it('does not expand from a navigation icon click', () => {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.appendChild(icon);

    component.onRailClick({ target: icon } as unknown as MouseEvent);

    expect(state.isExpanded()).toBe(false);
  });

  it('opens notifications and expands without a second toggle', () => {
    component.toggleNotifications();

    expect(component.isNotificationOpen).toBe(true);
    expect(state.isExpanded()).toBe(true);
    expect(loadNotifications).toHaveBeenCalledTimes(1);
  });

  it('keeps the expanded state when a route icon is activated', () => {
    state.expandSidebar();
    component.navigateHome();

    expect(state.isExpanded()).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/feed']);
  });

  it('collapses to compact and closes notifications from the backdrop', () => {
    state.expandSidebar();
    component.isNotificationOpen = true;

    component.onBackdropClick();

    expect(state.isExpanded()).toBe(false);
    expect(component.isNotificationOpen).toBe(false);
  });

  it('renders a compact rail by default and hover never expands it', () => {
    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    const rail = fixture.nativeElement.querySelector('.nf-rail') as HTMLElement;

    expect(rail).toBeTruthy();
    expect(rail.classList.contains('nf-rail--compact')).toBe(true);
    expect(rail.classList.contains('nf-rail--expanded')).toBe(false);

    rail.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    rail.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    fixture.detectChanges();

    expect(state.isExpanded()).toBe(false);
    expect(rail.classList.contains('nf-rail--compact')).toBe(true);
    fixture.destroy();
  });

  it('shows the overlay only while expanded and Escape returns to compact', () => {
    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    const backdrop = fixture.nativeElement.querySelector('.nf-sidebar-backdrop') as HTMLElement;

    expect(backdrop.classList.contains('nf-sidebar-backdrop--visible')).toBe(false);

    state.expandSidebar();
    fixture.detectChanges();
    expect(backdrop.classList.contains('nf-sidebar-backdrop--visible')).toBe(true);

    fixture.componentInstance.handleEscapeKey();
    fixture.detectChanges();
    expect(state.isExpanded()).toBe(false);
    expect(backdrop.classList.contains('nf-sidebar-backdrop--visible')).toBe(false);
    expect(fixture.nativeElement.querySelector('.nf-rail').classList.contains('nf-rail--compact')).toBe(true);
    fixture.destroy();
  });

  it('marks the app shell and tracks the expanded column width state', () => {
    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();

    expect(document.body.classList.contains('nf-has-dock')).toBe(true);
    expect(document.body.classList.contains('nf-sidebar-expanded')).toBe(false);

    state.expandSidebar();
    fixture.detectChanges();
    expect(document.body.classList.contains('nf-sidebar-expanded')).toBe(true);

    fixture.destroy();
    expect(document.body.classList.contains('nf-has-dock')).toBe(false);
    expect(document.body.classList.contains('nf-sidebar-expanded')).toBe(false);
  });
});
