import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BoardService } from '../../core/services/board';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { ProfileSummary, UserService } from '../../core/services/user';
import { Profile } from './profile';

describe('Profile', () => {
  const summary: ProfileSummary = {
    user: {
      id: 'artist-id',
      username: 'artist',
      avatarUrl: null,
      bio: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    counts: {
      posts: 1,
      albums: 0,
      followers: 2,
      following: 3,
      favorites: null,
    },
    viewer: {
      isOwnProfile: false,
      isFollowing: false,
      canViewFavorites: false,
    },
  };

  it('defaults to real user posts and rejects a private favorites query for another profile', async () => {
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
    };
    const router = { navigate: vi.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [Profile],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ username: 'artist' })),
            queryParamMap: of(convertToParamMap({ tab: 'favorites' })),
          },
        },
        { provide: Router, useValue: router },
        { provide: UserService, useValue: userService },
        { provide: BoardService, useValue: {} },
        { provide: PinService, useValue: {} },
        {
          provide: SupabaseService,
          useValue: { getSessionToken: vi.fn().mockResolvedValue('token') },
        },
      ],
    })
      .overrideComponent(Profile, { set: { template: '' } })
      .compileComponents();

    const fixture = TestBed.createComponent(Profile);
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
});
