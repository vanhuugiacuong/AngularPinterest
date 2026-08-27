import { Injectable, inject, signal } from '@angular/core';
import { Board, BoardService } from './board';
import { PinService } from './pin';
import { SupabaseService } from './supabase';
import { ToastService } from './toast';

/** How long the bookmark/heart ring runs. Must stay in step with the
 * .icon-burst / .icon-pop animations in styles.css. */
const BURST_MS = 520;

/**
 * Save and like for a pin card, in one place.
 *
 * This existed three times by hand — home.ts, pin-detail.ts and search.ts each
 * carried its own copy of the same board picker, the same optimistic like with
 * the same revert, the same burst timers. Three copies meant three chances to
 * fix a bug in only two of them, and they had already drifted: only some cleared
 * their timers on destroy, and each counted likes off a different field.
 *
 * Being a root service also fixes something the copies could not: the state is
 * shared, so saving a pin on the feed and then opening that pin shows it as
 * saved. Before, each component held its own Set and the second page had no idea
 * what had happened on the first.
 *
 * Templates stay with their pages. The feed, the search grid and the two related
 * strips have genuinely different layouts, and forcing one card component onto
 * all of them would be a far bigger change than the duplication cost.
 */
@Injectable({ providedIn: 'root' })
export class PinCardActionsService {
  private readonly boardService = inject(BoardService);
  private readonly pinService = inject(PinService);
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  readonly boards = signal<Board[]>([]);
  /** Which card has its board picker open. Keyed by id because a whole grid of
   * cards is on screen and only one menu may be open at a time. */
  readonly activeDropdownPinId = signal<string | null>(null);
  readonly savedPinIds = signal<Set<string>>(new Set<string>());
  readonly likedPinIds = signal<Set<string>>(new Set<string>());
  readonly saveBurstPinId = signal<string | null>(null);
  readonly likeBurstPinId = signal<string | null>(null);

  private saveBurstTimer: any = null;
  private likeBurstTimer: any = null;
  private boardsLoaded = false;

  /** Loads once per session: every page showing a card calls this on init, and
   * only the first call does any work. */
  async loadBoards(force = false): Promise<void> {
    if (this.boardsLoaded && !force) return;
    if (!this.supabase.user()) return;
    try {
      const token = await this.supabase.getSessionToken();
      if (!token) return;
      this.boards.set(await this.boardService.getBoards(token));
      this.boardsLoaded = true;
    } catch (error) {
      // No toast: saving still works and falls back to creating the default
      // board, so a failed list is not something the user has to act on.
      console.error('Error loading boards:', error);
    }
  }

  isSaved(pinId: string): boolean {
    return this.savedPinIds().has(pinId);
  }

  isLiked(pinId: string): boolean {
    return this.likedPinIds().has(pinId);
  }

  /** For a page with its own save flow. pin-detail's top-row button saves the
   * pin being viewed through a board dropdown of its own, which is a different
   * shape from a card's picker and stays there — but the resulting saved state
   * belongs here so the cards on the same page agree with it. */
  markSaved(pinId: string): void {
    this.savedPinIds.update((current) => new Set(current).add(pinId));
    this.fireSaveBurst(pinId);
  }

  /** Lets a page hand over liked state it learned from the server. pin-detail
   * knows the truth for the pin it is showing — the API sends the whole likes
   * array — and without this the heart would start empty there despite that. */
  seedLiked(pinIds: Iterable<string>): void {
    this.likedPinIds.update((current) => {
      const next = new Set(current);
      for (const id of pinIds) next.add(id);
      return next;
    });
  }

  /** With boards to choose from, ask which one; with none, save straight away
   * rather than opening an empty menu. */
  async onSaveClick(pinId: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (!this.supabase.user()) {
      this.toast.error('Bạn cần đăng nhập để lưu ảnh.');
      return;
    }
    if (this.boards().length > 0) {
      this.activeDropdownPinId.set(this.activeDropdownPinId() === pinId ? null : pinId);
      return;
    }
    await this.saveToBoard(pinId, null, event);
  }

  async saveToBoard(pinId: string, board: Board | null, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    this.activeDropdownPinId.set(null);
    if (!this.supabase.user()) return;

    try {
      const token = await this.supabase.getSessionToken();
      if (!token) return;

      let boardId = board?.id;
      let boardName = board?.name;

      if (!boardId) {
        const created = await this.boardService.createBoard(
          'Hồ sơ',
          'Bảng lưu mặc định',
          false,
          token,
        );
        this.boards.update((current) => [created, ...current]);
        boardId = created.id;
        boardName = created.name;
      }

      await this.boardService.addPinToBoard(boardId, pinId, token);
      // After the call, never before: the bookmark must not fill for a save that
      // then failed.
      this.savedPinIds.update((current) => new Set(current).add(pinId));
      this.fireSaveBurst(pinId);
      this.toast.success('Đã lưu vào bảng "' + boardName + '"!');
    } catch (error) {
      console.error('Error saving pin to board:', error);
      this.toast.error('Lỗi khi lưu ảnh vào bảng.');
    }
  }

  /**
   * Optimistic like. `pin` is whatever object the calling page holds, and the
   * three pages hold three different shapes — see bumpCount.
   *
   * @param onLocalChange runs after every local mutation, so a page whose list
   *   is an array of plain objects can poke its own signal to re-render.
   */
  async toggleLike(pin: any, event: MouseEvent, onLocalChange?: () => void): Promise<void> {
    event.stopPropagation();
    const user = this.supabase.user();
    if (!user) {
      this.toast.error('Bạn cần đăng nhập để thích ảnh.');
      return;
    }

    const wasLiked = this.likedPinIds().has(pin.id);
    const nextLiked = !wasLiked;

    const apply = (liked: boolean, delta: number) => {
      this.likedPinIds.update((current) => {
        const next = new Set(current);
        if (liked) next.add(pin.id);
        else next.delete(pin.id);
        return next;
      });
      this.bumpCount(pin, delta, user.id);
      onLocalChange?.();
    };

    apply(nextLiked, nextLiked ? 1 : -1);
    if (nextLiked) this.fireLikeBurst(pin.id);
    // Rides with the optimistic update so it lands as the heart fills; the
    // revert below takes back both the state and this claim.
    this.toast.success(nextLiked ? 'Đã thích ảnh này!' : 'Đã bỏ thích ảnh này.');

    try {
      const token = await this.supabase.getSessionToken();
      if (!token) return;
      const result = await this.pinService.toggleLike(pin.id, token);
      if (result.liked !== nextLiked) apply(result.liked, result.liked ? 1 : -1);
    } catch (error) {
      console.error('Error toggling like:', error);
      apply(wasLiked, nextLiked ? -1 : 1);
      this.toast.error('Không thể cập nhật lượt thích. Vui lòng thử lại.');
    }
  }

  /** Reads the count off whichever field the page's pin object carries. */
  likeCount(pin: any): number {
    if (Array.isArray(pin?.likes)) return pin.likes.length;
    if (typeof pin?.likes === 'number') return pin.likes;
    return pin?._count?.likes ?? 0;
  }

  /**
   * The three shapes this has to serve, all of them real:
   *   feed       — `likes` is a plain number (home.ts maps it from _count)
   *   search     — raw API object, so the count sits under `_count.likes`
   *   pin-detail — `likes` is the full array of {userId, pinId}
   * Each hand-written copy handled one shape and quietly did nothing for the
   * others, which is why the count on some pages never moved.
   */
  private bumpCount(pin: any, delta: number, userId: string): void {
    if (Array.isArray(pin?.likes)) {
      if (delta > 0) pin.likes = [...pin.likes, { userId, pinId: pin.id }];
      else pin.likes = pin.likes.filter((like: any) => like.userId !== userId);
      return;
    }
    if (typeof pin?.likes === 'number') {
      pin.likes = Math.max(0, pin.likes + delta);
      return;
    }
    if (pin?._count) pin._count.likes = Math.max(0, (pin._count.likes || 0) + delta);
  }

  private fireSaveBurst(pinId: string): void {
    this.saveBurstPinId.set(pinId);
    if (this.saveBurstTimer) clearTimeout(this.saveBurstTimer);
    this.saveBurstTimer = setTimeout(() => this.saveBurstPinId.set(null), BURST_MS);
  }

  private fireLikeBurst(pinId: string): void {
    this.likeBurstPinId.set(pinId);
    if (this.likeBurstTimer) clearTimeout(this.likeBurstTimer);
    this.likeBurstTimer = setTimeout(() => this.likeBurstPinId.set(null), BURST_MS);
  }
}
