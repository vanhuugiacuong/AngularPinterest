import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingService } from '../../core/services/messaging';
import { Notification, NotificationService } from '../../core/services/notification';
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
  const notificationsSubject = new BehaviorSubject<Notification[]>([]);
  const rejectFollowRequest = vi.fn();
  const acceptFollowRequest = vi.fn();
  const successToast = vi.fn();
  const errorToast = vi.fn();
  const authUser = vi.fn();
  const dbUser = vi.fn();

  beforeEach(() => {
    navigate.mockReset();
    loadNotifications.mockReset();
    rejectFollowRequest.mockReset().mockResolvedValue({ rejected: true });
    acceptFollowRequest.mockReset().mockResolvedValue({ accepted: true });
    successToast.mockReset();
    errorToast.mockReset();
    authUser.mockReset().mockReturnValue({
      id: 'supabase-user-id',
      email: 'tai@example.com',
      user_metadata: {},
    });
    dbUser.mockReset().mockReturnValue({
      username: 'tai',
      displayName: 'Tài',
      avatarUrl: null,
      plan: 'FREE',
    });
    notificationsSubject.next([]);
    TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        SidebarStateService,
        {
          provide: NotificationService,
          useValue: {
            unreadCount$: of(0),
            notifications$: notificationsSubject.asObservable(),
            loadNotifications,
            markAllAsRead: vi.fn(() => of({})),
            markAsRead: vi.fn(() => of({})),
          },
        },
        { provide: MessagingService, useValue: { unreadCount$: of(0) } },
        { provide: UserService, useValue: { rejectFollowRequest, acceptFollowRequest } },
        {
          provide: SupabaseService,
          useValue: {
            user: authUser,
            dbUser,
            getSessionToken: vi.fn().mockResolvedValue('token'),
          },
        },
        { provide: ToastService, useValue: { success: successToast, error: errorToast } },
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

  it('uses the Supabase UUID instead of an OAuth display name while profile sync is pending', () => {
    dbUser.mockReturnValue(null);
    authUser.mockReturnValue({
      id: '123e4567-e89b-42d3-a456-426614174000',
      email: 'minh@example.com',
      user_metadata: { full_name: 'Minh Chi Phạm Nguyễn' },
    });

    component.navigateToMyProfile();

    expect(navigate).toHaveBeenCalledWith([
      '/profile',
      '123e4567-e89b-42d3-a456-426614174000',
    ]);
    expect(navigate).not.toHaveBeenCalledWith([
      '/profile',
      'Minh Chi Phạm Nguyễn',
    ]);
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

  it('renders the outline SVG icon set with theme-aware currentColor strokes', () => {
    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();

    const icons = Array.from(fixture.nativeElement.querySelectorAll('.nf-rail-icon')) as HTMLElement[];
    const iconNames = icons.map((icon) => icon.dataset['icon']);

    expect(iconNames).toEqual([
      'home',
      'explore',
      'create',
      'collage',
      'notifications',
      'messages',
      'settings',
    ]);
    expect(
      icons.every((icon) => icon.querySelector('[stroke="currentColor"], [fill="currentColor"]')),
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('.nf-rail .material-symbols-outlined')).toBeNull();

    const homeSvg = icons[0].querySelector('svg');
    expect(homeSvg?.getAttribute('viewBox')).toBe('0 0 18 18');
    expect(homeSvg?.querySelector('path')?.getAttribute('stroke-width')).toBe('1.5');

    const createSvg = icons[2].querySelector('svg');
    expect(createSvg?.getAttribute('viewBox')).toBe('0 0 18 18');
    expect(createSvg?.querySelector('[fill-opacity="0.3"]')).toBeNull();

    const collageSvg = icons[3].querySelector('svg');
    expect(collageSvg?.getAttribute('viewBox')).toBe('0 0 18 18');
    expect(collageSvg?.querySelector('[fill-opacity="0.3"]')).toBeNull();

    const notificationsSvg = icons[4].querySelector('svg');
    expect(notificationsSvg?.getAttribute('viewBox')).toBe('0 0 18 18');
    expect(notificationsSvg?.querySelector('[fill-opacity="0.3"]')).toBeNull();

    const mobileIcons = Array.from(
      fixture.nativeElement.querySelectorAll('.nf-bottom-nav app-sidebar-icon'),
    ) as HTMLElement[];
    expect(mobileIcons.map((icon) => icon.dataset['icon'])).toEqual([
      'home',
      'create',
      'notifications',
      'messages',
      'settings',
    ]);
    expect(mobileIcons.every((icon) => icon.classList.contains('sidebar-icon--mobile'))).toBe(true);
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

  it('keeps a later follow request actionable after rejecting an older one from the same sender', async () => {
    const oldRequest: Notification = {
      id: 'follow-notification-1',
      userId: 'viewer',
      senderId: 'requester',
      type: 'FOLLOW_REQUEST',
      content: 'Người dùng muốn theo dõi bạn.',
      isRead: true,
      createdAt: '2026-08-27T00:00:00.000Z',
    };
    const laterRequest: Notification = {
      ...oldRequest,
      id: 'follow-notification-2',
      createdAt: '2026-08-27T01:00:00.000Z',
    };

    notificationsSubject.next([oldRequest]);
    await component.rejectFollowRequest(oldRequest);
    notificationsSubject.next([laterRequest, oldRequest]);

    expect(rejectFollowRequest).toHaveBeenCalledWith('requester', 'token');
    expect(component.getFollowRequestResult(oldRequest)).toBe('rejected');
    expect(component.isPendingFollowRequest(oldRequest)).toBe(false);
    expect(component.getFollowRequestResult(laterRequest)).toBeNull();
    expect(component.isPendingFollowRequest(laterRequest)).toBe(true);
  });
});
