import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BoardService } from '../../core/services/board';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { ProfileSummary, ProfileViewerState, UserService } from '../../core/services/user';
import { MessagingService } from '../../core/services/messaging';
import { SafetyService } from '../../core/services/safety';
import { Profile } from './profile';

function baseViewer(overrides: Partial<ProfileViewerState> = {}): ProfileViewerState {
  return {
    isOwnProfile: false,
    isFollowing: false,
    isFollowedBy: false,
    isMutualFollow: false,
    hasPendingFollowRequest: false,
    canViewFavorites: false,
    canViewPrivateBoards: false,
    canViewPosts: true,
    messageRequestStatus: 'NONE',
    conversationId: null,
    isBlocked: false,
    isBlockedByTarget: false,
    canMessage: false,
    canSendMessageRequest: true,
    ...overrides,
  };
}

describe('Profile', () => {
  const summary: ProfileSummary = {
    user: {
      id: 'artist-id',
      username: 'artist',
      avatarUrl: null,
      bio: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      plan: 'FREE',
    },
    counts: {
      posts: 1,
      albums: 0,
      followers: 2,
      following: 3,
      favorites: null,
      privateBoards: null,
    },
    viewer: baseViewer(),
  };

  function setup(
    overrides: { userService?: object; messagingService?: object; safetyService?: object; tab?: string } = {},
  ) {
    const userService = {
      getUserProfile: vi.fn().mockResolvedValue(summary),
      getUserPosts: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        hasMore: false,
      }),
      getUserAlbums: vi.fn(),
      getFavorites: vi.fn(),
      getPrivateBoards: vi.fn(),
      ...overrides.userService,
    };
    const messagingService = {
      sendMessageRequest: vi.fn(),
      openDirectConversation: vi.fn(),
      ...overrides.messagingService,
    };
    const safetyService = {
      blockUser: vi.fn(),
      unblockUser: vi.fn(),
      reportUser: vi.fn(),
      ...overrides.safetyService,
    };
    const router = { navigate: vi.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [Profile],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ username: 'artist' })),
            queryParamMap: of(convertToParamMap({ tab: overrides.tab ?? 'favorites' })),
          },
        },
        { provide: Router, useValue: router },
        { provide: UserService, useValue: userService },
        { provide: BoardService, useValue: {} },
        { provide: PinService, useValue: {} },
        { provide: MessagingService, useValue: messagingService },
        { provide: SafetyService, useValue: safetyService },
        {
          provide: SupabaseService,
          useValue: { getSessionToken: vi.fn().mockResolvedValue('token') },
        },
      ],
    }).overrideComponent(Profile, { set: { template: '' } });

    const fixture = TestBed.createComponent(Profile);
    return { fixture, userService, messagingService, safetyService, router };
  }

  it('defaults to real user posts and rejects a private favorites query for another profile', async () => {
    const { fixture, userService, router } = setup();
    fixture.detectChanges();

    await vi.waitFor(() => expect(userService.getUserPosts).toHaveBeenCalled());
    expect(fixture.componentInstance.activeTab()).toBe('posts');
    expect(userService.getFavorites).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { tab: 'posts' } }),
    );

    fixture.destroy();
  });

  it('redirects ?tab=private to posts and never requests private boards when the viewer is not the owner', async () => {
    const { fixture, userService, router } = setup({ tab: 'private' });
    fixture.detectChanges();

    await vi.waitFor(() => expect(userService.getUserPosts).toHaveBeenCalled());
    expect(fixture.componentInstance.activeTab()).toBe('posts');
    expect(userService.getPrivateBoards).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { tab: 'posts' } }),
    );

    fixture.destroy();
  });

  it('loads the private-boards tab for the profile owner when ?tab=private is requested', async () => {
    const ownProfileSummary = {
      ...summary,
      viewer: baseViewer({ isOwnProfile: true, canViewFavorites: true, canViewPrivateBoards: true }),
    };
    const { fixture, userService, router } = setup({
      tab: 'private',
      userService: {
        getUserProfile: vi.fn().mockResolvedValue(ownProfileSummary),
        getPrivateBoards: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, hasMore: false }),
      },
    });
    fixture.detectChanges();

    await vi.waitFor(() => expect(userService.getPrivateBoards).toHaveBeenCalled());
    expect(fixture.componentInstance.activeTab()).toBe('private');
    expect(router.navigate).not.toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { tab: 'posts' } }),
    );

    fixture.destroy();
  });

  it('shows "Nhắn tin" and is enabled once mutual follow / an accepted request allows messaging', () => {
    const { fixture } = setup();
    const profile = fixture.componentInstance;
    profile.profile.set({
      ...summary,
      viewer: baseViewer({ isMutualFollow: true, canMessage: true, canSendMessageRequest: false }),
    });

    expect(profile.messageButtonLabel()).toBe('Nhắn tin');
    expect(profile.messageButtonDisabled()).toBe(false);
  });

  it('shows "Gửi yêu cầu nhắn tin" enabled when no request exists yet', () => {
    const { fixture } = setup();
    const profile = fixture.componentInstance;
    profile.profile.set({ ...summary, viewer: baseViewer() });

    expect(profile.messageButtonLabel()).toBe('Gửi yêu cầu nhắn tin');
    expect(profile.messageButtonDisabled()).toBe(false);
  });

  it('shows a disabled "Đang chờ phản hồi" while a request is pending', () => {
    const { fixture } = setup();
    const profile = fixture.componentInstance;
    profile.profile.set({
      ...summary,
      viewer: baseViewer({ messageRequestStatus: 'PENDING_OUTGOING', canSendMessageRequest: false }),
    });

    expect(profile.messageButtonLabel()).toBe('Đang chờ phản hồi');
    expect(profile.messageButtonDisabled()).toBe(true);
  });

  it('shows a disabled state once a request was rejected, and never lets it be resent', () => {
    const { fixture } = setup();
    const profile = fixture.componentInstance;
    profile.profile.set({
      ...summary,
      viewer: baseViewer({ messageRequestStatus: 'REJECTED', canSendMessageRequest: false }),
    });

    expect(profile.messageButtonLabel()).toBe('Yêu cầu đã bị từ chối');
    expect(profile.messageButtonDisabled()).toBe(true);
  });

  it('disables messaging entirely once blocked, regardless of follow state', () => {
    const { fixture } = setup();
    const profile = fixture.componentInstance;
    profile.profile.set({
      ...summary,
      viewer: baseViewer({
        isMutualFollow: true,
        isBlocked: true,
        canMessage: false,
        canSendMessageRequest: false,
      }),
    });

    expect(profile.messageButtonLabel()).toBe('Đã chặn người dùng này');
    expect(profile.messageButtonDisabled()).toBe(true);
  });

  it('sends a message request and flips the button to the pending state optimistically', async () => {
    const { fixture, messagingService } = setup({
      messagingService: {
        sendMessageRequest: vi.fn().mockResolvedValue({ id: 'req-1', status: 'PENDING' }),
      },
    });
    const profile = fixture.componentInstance;
    profile.profile.set({ ...summary, viewer: baseViewer() });

    await profile.onMessageAction();

    expect(messagingService.sendMessageRequest).toHaveBeenCalledWith('artist-id', 'token');
    expect(profile.profile()?.viewer.messageRequestStatus).toBe('PENDING_OUTGOING');
    expect(profile.messageButtonDisabled()).toBe(true);
  });

  it('toggles the safety chevron menu open and closed', () => {
    const { fixture } = setup();
    const profile = fixture.componentInstance;
    const event = { stopPropagation: vi.fn() } as unknown as Event;

    expect(profile.showSafetyMenu()).toBe(false);
    profile.toggleSafetyMenu(event);
    expect(profile.showSafetyMenu()).toBe(true);
    profile.toggleSafetyMenu(event);
    expect(profile.showSafetyMenu()).toBe(false);
  });

  it('closes the safety menu on Escape', () => {
    const { fixture } = setup();
    const profile = fixture.componentInstance;
    profile.showSafetyMenu.set(true);

    profile.onDocumentKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(profile.showSafetyMenu()).toBe(false);
  });

  it('flags isOwnProfile so the template can hide follow/message/safety actions (guarded by *ngIf="!p.viewer.isOwnProfile" in profile.html)', () => {
    const { fixture } = setup();
    const profile = fixture.componentInstance;
    profile.profile.set({
      ...summary,
      viewer: baseViewer({ isOwnProfile: true, canSendMessageRequest: false }),
    });

    expect(profile.isOwnProfile()).toBe(true);
  });
});
