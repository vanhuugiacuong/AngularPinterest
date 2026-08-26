import { CommonModule } from '@angular/common';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { Navbar } from '../../components/navbar/navbar';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';
import { LikeButton } from '../../shared/like-button/like-button';
import { BoardService } from '../../core/services/board';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { ProfileAlbum, ProfilePin, ProfileSummary, UserService } from '../../core/services/user';
import { MessagingService, ReportReason } from '../../core/services/messaging';
import { SafetyService } from '../../core/services/safety';
import { MarketplaceSale, MembershipService, PendingSale } from '../../core/services/membership';
import { AuctionBiddingSummary, AuctionSellingSummary, AuctionService } from '../../core/services/auction';
import { toUserMessage } from '../../core/utils/http-error';
import { FollowListDialog } from './follow-list-dialog/follow-list-dialog';
import { DialogService } from '../../core/services/dialog';

type ProfileTab = 'favorites' | 'albums' | 'posts' | 'private';

interface TabState<T> {
  items: T[];
  page: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule, UserAvatar, FollowListDialog, LikeButton],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly boardService = inject(BoardService);
  private readonly pinService = inject(PinService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly messagingService = inject(MessagingService);
  private readonly safetyService = inject(SafetyService);
  private readonly membershipService = inject(MembershipService);
  private readonly auctionService = inject(AuctionService);
  private readonly dialogService = inject(DialogService);

  readonly marketplaceSales = signal<MarketplaceSale[]>([]);
  readonly marketplaceRevenue = signal(0);
  readonly marketplacePurchases = signal<MarketplaceSale[]>([]);
  readonly marketplacePendingSales = signal<PendingSale[]>([]);
  readonly marketplaceLoading = signal(false);
  readonly marketplaceError = signal<string | null>(null);
  readonly confirmReceivedPendingId = signal<string | null>(null);

  readonly auctionsSelling = signal<AuctionSellingSummary[]>([]);
  readonly auctionsBidding = signal<AuctionBiddingSummary[]>([]);
  readonly auctionsLoading = signal(false);
  readonly auctionsError = signal<string | null>(null);
  readonly auctionCancelPendingId = signal<string | null>(null);

  readonly profile = signal<ProfileSummary | null>(null);
  readonly profileLoading = signal(true);
  readonly profileError = signal<string | null>(null);
  readonly activeTab = signal<ProfileTab>('posts');
  readonly favoritesState = signal(this.emptyState<ProfilePin>());
  readonly albumsState = signal(this.emptyState<ProfileAlbum>());
  readonly postsState = signal(this.emptyState<ProfilePin>());
  readonly privateState = signal(this.emptyState<ProfileAlbum>());
  readonly followPending = signal(false);
  readonly shareMessage = signal<string | null>(null);
  readonly actionMessage = signal<string | null>(null);
  readonly activePostMenu = signal<string | null>(null);

  readonly showCreateAlbumModal = signal(false);
  readonly albumSubmitPending = signal(false);
  readonly albumFormError = signal<string | null>(null);
  newAlbumName = '';
  newAlbumDescription = '';
  newAlbumSecret = false;

  readonly messageActionPending = signal(false);
  readonly showSafetyMenu = signal(false);

  readonly showReportDialog = signal(false);
  readonly reportReason = signal<ReportReason>('SPAM');
  readonly reportPending = signal(false);
  readonly reportError = signal<string | null>(null);
  reportDetails = '';

  readonly showEditProfileDialog = signal(false);
  readonly editProfilePending = signal(false);
  readonly editProfileError = signal<string | null>(null);
  readonly editAvatarPreviewUrl = signal<string | null>(null);
  editDisplayName = '';
  editUsername = '';
  editBio = '';
  private editAvatarFile?: File;

  private readonly pageSize = 20;
  private routeSubscription?: Subscription;
  private currentUsername = '';
  private requestVersion = 0;
  private dialogReturnFocus?: HTMLElement;

  /** Hero avatar's pixel size, matching the .profile-avatar-slot breakpoints
   * in profile.css (108 / 80 / 72px) — set here rather than in CSS because
   * <app-user-avatar>'s box size is driven by its `size` input, not a CSS
   * width/height an ancestor stylesheet could override. */
  public profileAvatarSize = signal(108);

  @HostListener('window:resize')
  onWindowResize() {
    this.updateProfileAvatarSize();
  }

  ngOnInit() {
    this.updateProfileAvatarSize();
    this.routeSubscription = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([params, query]) => {
      const username = params.get('username');
      if (!username) return;

      const requestedTab = this.parseTab(query.get('tab'));
      if (username !== this.currentUsername) {
        this.currentUsername = username;
        void this.loadProfile(username, requestedTab);
      } else if (this.profile()) {
        this.activateRequestedTab(requestedTab);
      }
    });
  }

  private updateProfileAvatarSize() {
    if (typeof window === 'undefined') return;
    const width = window.innerWidth;
    this.profileAvatarSize.set(width <= 430 ? 72 : width <= 720 ? 80 : 108);
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.requestVersion += 1;
  }

  async loadProfile(username = this.currentUsername, requestedTab?: ProfileTab) {
    const version = ++this.requestVersion;
    this.profileLoading.set(true);
    this.profileError.set(null);
    this.profile.set(null);
    this.resetTabStates();
    this.activePostMenu.set(null);

    try {
      const token = (await this.supabaseService.getSessionToken()) || undefined;
      const summary = await this.userService.getUserProfile(username, token);
      if (version !== this.requestVersion) return;

      this.profile.set(summary);
      this.activateRequestedTab(requestedTab || 'posts');
      if (summary.viewer.isOwnProfile) {
        void this.loadMarketplace();
        void this.loadAuctions();
      }
    } catch (error) {
      if (version !== this.requestVersion) return;
      this.profileError.set(this.errorMessage(error, 'Không thể tải hồ sơ này.'));
    } finally {
      if (version === this.requestVersion) {
        this.profileLoading.set(false);
      }
    }
  }

  private async loadMarketplace(): Promise<void> {
    this.marketplaceLoading.set(true);
    this.marketplaceError.set(null);
    try {
      const [salesResult, purchases, pendingSales] = await Promise.all([
        this.membershipService.listSales(),
        this.membershipService.listPurchases(),
        this.membershipService.listPendingSales(),
      ]);
      this.marketplaceSales.set(salesResult.sales);
      this.marketplaceRevenue.set(salesResult.revenue);
      this.marketplacePurchases.set(purchases);
      this.marketplacePendingSales.set(pendingSales);
    } catch (error) {
      this.marketplaceError.set(this.errorMessage(error, 'Không thể tải dữ liệu marketplace.'));
    } finally {
      this.marketplaceLoading.set(false);
    }
  }

  /** Người bán tự xác nhận đã nhận được thanh toán chuyển thẳng vào tài
   * khoản riêng — tiền không qua platform nên không có webhook nào xác
   * nhận hộ. Backend vẫn tự kiểm tra sellerId trước khi cho phép. */
  async confirmReceived(purchaseId: string): Promise<void> {
    if (this.confirmReceivedPendingId()) return;
    this.confirmReceivedPendingId.set(purchaseId);
    try {
      await this.membershipService.confirmReceived(purchaseId);
      await this.loadMarketplace();
      this.announce('Đã xác nhận nhận được thanh toán.');
    } catch (error) {
      this.announce(this.errorMessage(error, 'Không thể xác nhận thanh toán.'));
    } finally {
      this.confirmReceivedPendingId.set(null);
    }
  }

  private async loadAuctions(): Promise<void> {
    this.auctionsLoading.set(true);
    this.auctionsError.set(null);
    try {
      const [selling, bidding] = await Promise.all([
        this.auctionService.listSelling(),
        this.auctionService.listBidding(),
      ]);
      this.auctionsSelling.set(selling);
      this.auctionsBidding.set(bidding);
    } catch (error) {
      this.auctionsError.set(this.errorMessage(error, 'Không thể tải dữ liệu đấu giá.'));
    } finally {
      this.auctionsLoading.set(false);
    }
  }

  auctionStatusLabel(status: string): string {
    switch (status) {
      case 'DRAFT':
        return 'Nháp';
      case 'SCHEDULED':
        return 'Sắp diễn ra';
      case 'ACTIVE':
        return 'Đang diễn ra';
      case 'ENDED':
        return 'Đã kết thúc';
      case 'CANCELLED':
        return 'Đã hủy';
      default:
        return status;
    }
  }

  purchaseStatusLabel(status: string | null): string {
    if (!status) return 'Chưa có người thắng';
    if (status === 'PAID') return 'Đã thanh toán';
    if (status === 'PENDING') return 'Chờ thanh toán';
    return 'Thất bại';
  }

  canCancelAuction(a: AuctionSellingSummary): boolean {
    return a.bidCount === 0 && (a.status === 'SCHEDULED' || a.status === 'ACTIVE');
  }

  async cancelAuction(id: string): Promise<void> {
    if (this.auctionCancelPendingId()) return;
    this.auctionCancelPendingId.set(id);
    try {
      await this.auctionService.cancel(id);
      await this.loadAuctions();
      this.announce('Đã hủy phiên đấu giá.');
    } catch (error) {
      this.announce(this.errorMessage(error, 'Không thể hủy phiên đấu giá.'));
    } finally {
      this.auctionCancelPendingId.set(null);
    }
  }

  setTab(tab: ProfileTab, focusTab = false) {
    if (!this.canUseTab(tab)) tab = 'posts';
    this.activeTab.set(tab);
    void this.ensureTabLoaded(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    if (focusTab) {
      setTimeout(() => document.getElementById(`profile-tab-${tab}`)?.focus());
    }
  }

  onTabKeydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = this.availableTabs();
    const currentIndex = Math.max(0, tabs.indexOf(this.activeTab()));
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    this.setTab(tabs[nextIndex], true);
  }

  async retryActiveTab() {
    await this.loadTab(this.activeTab(), false, true);
  }

  async loadMore() {
    await this.loadTab(this.activeTab(), true);
  }

  /** Handles all three follow states with one call - the backend decides
   * whether a click follows immediately (public account), sends/withdraws a
   * pending FollowRequest (private account), or unfollows, based on the
   * target's isPrivate flag and any existing Follow/FollowRequest row. The
   * optimistic update below predicts that same branching client-side using
   * the isPrivate flag we already have, so the button never flashes the
   * wrong state while the request is in flight. */
  async toggleFollow() {
    const summary = this.profile();
    if (!summary || summary.viewer.isOwnProfile || this.followPending()) return;

    const previousStatus = summary.viewer.followRequestStatus;
    const previousCount = summary.counts.followers;
    // Unfollowing (leaving ACCEPTED) is the only transition that actually
    // changes the follower count right away — sending/withdrawing a request
    // never did, since it was never counted as a follower yet.
    const wasAccepted = previousStatus === 'ACCEPTED';
    const optimisticStatus = wasAccepted ? 'NONE' : previousStatus === 'NONE' ? 'PENDING_OUTGOING' : 'NONE';
    this.followPending.set(true);
    this.profile.set({
      ...summary,
      viewer: { ...summary.viewer, followRequestStatus: optimisticStatus, isFollowing: false },
      counts: {
        ...summary.counts,
        followers: Math.max(0, previousCount + (wasAccepted ? -1 : 0)),
      },
    });

    try {
      const token = await this.requireToken();
      const result = await this.userService.toggleFollow(summary.user.id, token);
      this.updateProfile((current) => ({
        ...current,
        viewer: {
          ...current.viewer,
          followRequestStatus: result.followRequestStatus,
          isFollowing: result.followRequestStatus === 'ACCEPTED',
        },
        counts: { ...current.counts, followers: result.followerCount },
      }));
    } catch (error) {
      this.updateProfile((current) => ({
        ...current,
        viewer: { ...current.viewer, followRequestStatus: previousStatus, isFollowing: wasAccepted },
        counts: { ...current.counts, followers: previousCount },
      }));
      this.announce(this.errorMessage(error, 'Không thể cập nhật theo dõi.'));
    } finally {
      this.followPending.set(false);
    }
  }

  async shareProfile() {
    const summary = this.profile();
    if (!summary) return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `@${summary.user.username} trên NovaFrame`,
          text: `Khám phá không gian sáng tạo của @${summary.user.username}.`,
          url,
        });
        this.shareMessage.set('Đã mở bảng chia sẻ.');
      } else {
        await navigator.clipboard.writeText(url);
        this.shareMessage.set('Đã sao chép liên kết hồ sơ.');
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        this.shareMessage.set('Không thể chia sẻ liên kết lúc này.');
      }
    }
    setTimeout(() => this.shareMessage.set(null), 3000);
  }

  messageButtonLabel(): string {
    const viewer = this.profile()?.viewer;
    if (!viewer) return '';
    if (viewer.canMessage) return 'Nhắn tin';
    if (viewer.isBlocked) return 'Đã chặn người dùng này';
    if (viewer.isBlockedByTarget) return 'Không thể nhắn tin';
    switch (viewer.messageRequestStatus) {
      case 'PENDING_OUTGOING':
        return 'Đang chờ phản hồi';
      case 'PENDING_INCOMING':
        return 'Phản hồi trong Tin nhắn';
      case 'REJECTED':
        return 'Yêu cầu đã bị từ chối';
      case 'REPORTED':
        return 'Yêu cầu đã bị báo cáo';
      default:
        return 'Gửi yêu cầu nhắn tin';
    }
  }

  messageButtonDisabled(): boolean {
    const viewer = this.profile()?.viewer;
    if (!viewer || this.messageActionPending()) return true;
    return !viewer.canMessage && !viewer.canSendMessageRequest;
  }

  async onMessageAction() {
    const summary = this.profile();
    if (!summary || this.messageActionPending()) return;
    const viewer = summary.viewer;

    if (viewer.canMessage) {
      this.messageActionPending.set(true);
      try {
        const token = await this.requireToken();
        const conversationId =
          viewer.conversationId ||
          (await this.messagingService.openDirectConversation(summary.user.id, token)).id;
        void this.router.navigate(['/messages', conversationId]);
      } catch (error) {
        this.announce(this.errorMessage(error, 'Không thể mở cuộc trò chuyện.'));
      } finally {
        this.messageActionPending.set(false);
      }
      return;
    }

    if (viewer.canSendMessageRequest) {
      this.messageActionPending.set(true);
      try {
        const token = await this.requireToken();
        await this.messagingService.sendMessageRequest(summary.user.id, token);
        this.updateProfile((current) => ({
          ...current,
          viewer: {
            ...current.viewer,
            messageRequestStatus: 'PENDING_OUTGOING',
            canSendMessageRequest: false,
          },
        }));
        this.announce('Đã gửi yêu cầu nhắn tin.');
      } catch (error) {
        this.announce(this.errorMessage(error, 'Không thể gửi yêu cầu nhắn tin.'));
      } finally {
        this.messageActionPending.set(false);
      }
    }
  }

  toggleSafetyMenu(event: Event) {
    event.stopPropagation();
    this.showSafetyMenu.update((value) => !value);
  }

  followDialogTab = signal<'followers' | 'following' | null>(null);

  openFollowersDialog() {
    this.dialogReturnFocus = document.activeElement as HTMLElement;
    this.followDialogTab.set('followers');
  }

  openFollowingDialog() {
    this.dialogReturnFocus = document.activeElement as HTMLElement;
    this.followDialogTab.set('following');
  }

  closeFollowDialog() {
    this.followDialogTab.set(null);
    this.restoreDialogFocus();
  }

  openReportDialog() {
    this.showSafetyMenu.set(false);
    this.dialogReturnFocus = document.activeElement as HTMLElement;
    this.reportReason.set('SPAM');
    this.reportDetails = '';
    this.reportError.set(null);
    this.showReportDialog.set(true);
    setTimeout(() => document.getElementById('report-reason')?.focus());
  }

  closeReportDialog() {
    if (this.reportPending()) return;
    this.showReportDialog.set(false);
    this.reportError.set(null);
    this.restoreDialogFocus();
  }

  async submitReport() {
    const summary = this.profile();
    if (!summary || this.reportPending()) return;
    this.reportPending.set(true);
    this.reportError.set(null);
    try {
      const token = await this.requireToken();
      await this.safetyService.reportUser(
        summary.user.id,
        this.reportReason(),
        this.reportDetails.trim() || undefined,
        token,
      );
      this.showReportDialog.set(false);
      this.announce('Đã gửi báo cáo. Cảm ơn bạn đã phản hồi.');
      this.restoreDialogFocus();
    } catch (error) {
      this.reportError.set(this.errorMessage(error, 'Không thể gửi báo cáo.'));
    } finally {
      this.reportPending.set(false);
    }
  }

  async openBlockDialog() {
    this.showSafetyMenu.set(false);
    const summary = this.profile();
    if (!summary) return;
    const wasBlocked = summary.viewer.isBlocked;
    const confirmed = await this.dialogService.confirm({
      variant: 'destructive',
      title: wasBlocked ? `Bỏ chặn @${summary.user.username}?` : `Chặn @${summary.user.username}?`,
      description: wasBlocked
        ? 'Hai bạn sẽ có thể theo dõi và nhắn tin lại với nhau như bình thường.'
        : 'Người này sẽ không thể gửi yêu cầu nhắn tin hoặc nhắn tin cho bạn nữa.',
      confirmLabel: wasBlocked ? 'Bỏ chặn' : 'Chặn người dùng',
      cancelLabel: 'Hủy',
      onConfirm: async () => {
        const token = await this.requireToken();
        if (wasBlocked) {
          await this.safetyService.unblockUser(summary.user.id, token);
        } else {
          await this.safetyService.blockUser(summary.user.id, token);
        }
        await this.refreshProfileViewerState();
      },
    });
    if (confirmed) this.announce(wasBlocked ? 'Đã bỏ chặn người dùng.' : 'Đã chặn người dùng.');
  }

  navigateToProfile(username: string | undefined | null) {
    if (!username) return;
    void this.router.navigate(['/profile', username]);
  }

  navigateToPin(pinId: string) {
    void this.router.navigate(['/pin', pinId]);
  }

  navigateToAlbum(albumId: string) {
    void this.router.navigate(['/board', albumId]);
  }

  navigateTo(path: string) {
    void this.router.navigate([path]);
  }

  async removeFavorite(pin: ProfilePin, event: Event) {
    event.stopPropagation();
    const state = this.favoritesState();
    const index = state.items.findIndex((item) => item.id === pin.id);
    if (index < 0) return;

    const optimisticItems = state.items.filter((item) => item.id !== pin.id);
    this.favoritesState.set({ ...state, items: optimisticItems });
    this.adjustCount('favorites', -1);

    try {
      const token = await this.requireToken();
      const result = await this.pinService.toggleLike(pin.id, token);
      if (result.liked) {
        throw new Error('Tác phẩm vẫn đang ở trạng thái yêu thích.');
      }
      this.announce('Đã bỏ khỏi Yêu thích.');
    } catch (error) {
      const restored = [...this.favoritesState().items];
      restored.splice(Math.min(index, restored.length), 0, pin);
      this.favoritesState.update((current) => ({ ...current, items: restored }));
      this.adjustCount('favorites', 1);
      this.announce(this.errorMessage(error, 'Không thể bỏ yêu thích.'));
    }
  }

  togglePostMenu(pinId: string, event: Event) {
    event.stopPropagation();
    this.activePostMenu.update((current) => (current === pinId ? null : pinId));
  }

  async openDeleteDialog(pin: ProfilePin, event?: Event) {
    event?.stopPropagation();
    this.activePostMenu.set(null);
    const confirmed = await this.dialogService.confirm({
      variant: 'destructive',
      title: `Xóa "${pin.title}"?`,
      description: 'Tác phẩm sẽ bị xóa khỏi NovaFrame và không thể khôi phục.',
      confirmLabel: 'Xóa bài',
      cancelLabel: 'Giữ lại',
      onConfirm: async () => {
        const token = await this.requireToken();
        await this.pinService.deletePin(pin.id, token);
        this.postsState.update((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== pin.id),
        }));
        this.adjustCount('posts', -1);
      },
    });
    if (confirmed) this.announce('Đã xóa tác phẩm.');
  }

  openCreateAlbumModal(forcePrivate = false) {
    if (!this.isOwnProfile()) return;
    this.dialogReturnFocus = document.activeElement as HTMLElement;
    this.newAlbumName = '';
    this.newAlbumDescription = '';
    this.newAlbumSecret = forcePrivate;
    this.albumFormError.set(null);
    this.showCreateAlbumModal.set(true);
    setTimeout(() => document.getElementById('album-name')?.focus());
  }

  closeCreateAlbumModal() {
    if (this.albumSubmitPending()) return;
    this.showCreateAlbumModal.set(false);
    this.albumFormError.set(null);
    this.restoreDialogFocus();
  }

  async createAlbum() {
    const name = this.newAlbumName.trim();
    if (!name || this.albumSubmitPending()) return;
    this.albumSubmitPending.set(true);
    this.albumFormError.set(null);
    try {
      const token = await this.requireToken();
      const board = await this.boardService.createBoard(
        name,
        this.newAlbumDescription.trim(),
        this.newAlbumSecret,
        token,
      );
      const album: ProfileAlbum = {
        ...board,
        description: board.description || null,
        pinCount: 0,
        thumbnails: [],
      };
      if (this.newAlbumSecret) {
        this.privateState.update((current) => ({
          ...current,
          loaded: true,
          items: [album, ...current.items],
        }));
        this.adjustCount('private', 1);
      } else {
        this.albumsState.update((current) => ({
          ...current,
          loaded: true,
          items: [album, ...current.items],
        }));
        this.adjustCount('albums', 1);
      }
      this.showCreateAlbumModal.set(false);
      this.announce('Album mới đã được tạo.');
      this.restoreDialogFocus();
    } catch (error) {
      this.albumFormError.set(this.errorMessage(error, 'Không thể tạo album.'));
    } finally {
      this.albumSubmitPending.set(false);
    }
  }

  openEditProfileDialog() {
    const p = this.profile();
    if (!p || !p.viewer.isOwnProfile) return;
    this.dialogReturnFocus = document.activeElement as HTMLElement;
    this.editDisplayName = p.user.displayName || '';
    this.editUsername = p.user.username;
    this.editBio = p.user.bio || '';
    this.editAvatarFile = undefined;
    this.releaseAvatarPreview();
    this.editProfileError.set(null);
    this.showEditProfileDialog.set(true);
    setTimeout(() => document.getElementById('edit-profile-display-name')?.focus());
  }

  closeEditProfileDialog() {
    if (this.editProfilePending()) return;
    this.showEditProfileDialog.set(false);
    this.editProfileError.set(null);
    this.releaseAvatarPreview();
    this.restoreDialogFocus();
  }

  onEditAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      this.editProfileError.set('Ảnh đại diện phải là JPG, PNG hoặc WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.editProfileError.set('Ảnh đại diện tối đa 5MB.');
      return;
    }
    this.editProfileError.set(null);
    this.editAvatarFile = file;
    this.releaseAvatarPreview();
    this.editAvatarPreviewUrl.set(URL.createObjectURL(file));
  }

  private releaseAvatarPreview() {
    const url = this.editAvatarPreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.editAvatarPreviewUrl.set(null);
  }

  async saveProfileEdits() {
    const current = this.profile();
    if (!current || this.editProfilePending()) return;

    const displayName = this.editDisplayName.trim();
    const username = this.editUsername.trim();
    const bio = this.editBio.trim();
    if (displayName.length > 50) {
      this.editProfileError.set('Tên hiển thị tối đa 50 ký tự.');
      return;
    }
    if (!username) {
      this.editProfileError.set('Nhập ID cho hồ sơ.');
      return;
    }
    if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) {
      this.editProfileError.set('ID phải từ 3-20 ký tự, chỉ gồm chữ, số, dấu chấm hoặc gạch dưới.');
      return;
    }
    if (bio.length > 280) {
      this.editProfileError.set('Tiểu sử tối đa 280 ký tự.');
      return;
    }

    this.editProfilePending.set(true);
    this.editProfileError.set(null);
    try {
      const token = await this.requireToken();
      const usernameChanged = username !== current.user.username;
      // displayName/bio are always sent (even empty, to allow clearing them);
      // username/avatar are only sent when actually changed, so a save that
      // only edits the bio never re-triggers ID-uniqueness checks or a
      // needless avatar re-upload.
      const updated = await this.userService.updateProfile(
        {
          displayName,
          username: usernameChanged ? username : undefined,
          bio,
          avatar: this.editAvatarFile,
        },
        token,
      );

      const dbUser = this.supabaseService.dbUser();
      if (dbUser) {
        this.supabaseService.dbUser.set({
          ...dbUser,
          username: updated.username,
          displayName: updated.displayName,
          bio: updated.bio,
          avatarUrl: updated.avatarUrl,
        });
      }

      this.showEditProfileDialog.set(false);
      this.releaseAvatarPreview();
      this.announce('Đã cập nhật hồ sơ.');
      this.restoreDialogFocus();

      if (usernameChanged) {
        await this.router.navigate(['/profile', updated.username], { replaceUrl: true });
      } else {
        this.updateProfile((p) => ({
          ...p,
          user: {
            ...p.user,
            displayName: updated.displayName,
            bio: updated.bio,
            avatarUrl: updated.avatarUrl,
          },
        }));
      }
    } catch (error) {
      this.editProfileError.set(this.errorMessage(error, 'Lỗi máy chủ. Vui lòng thử lại sau.'));
    } finally {
      this.editProfilePending.set(false);
    }
  }

  /** Tracks where a press on a dialog backdrop started. A dialog must only
   * close when BOTH the mousedown AND the resulting click landed on the
   * backdrop itself — checking the click alone isn't enough: dragging to
   * select text that starts inside the panel (e.g. selecting the ID field
   * to retype it) and releasing outside the panel gets its `click` event
   * retargeted by the browser to the nearest common ancestor, which is this
   * backdrop, since mousedown and mouseup landed on different elements.
   * Closing is still driven by `click` (not `mousedown` directly) so a
   * genuine backdrop click behaves like every other click-to-dismiss
   * control in the app and never interferes with the browser's own
   * text-selection/drag handling. */
  private backdropMouseDownTarget: EventTarget | null = null;

  onDialogBackdropMouseDown(event: MouseEvent) {
    this.backdropMouseDownTarget = event.target;
  }

  private backdropPressStartedOnBackdrop(event: MouseEvent): boolean {
    const startedOnBackdrop = this.backdropMouseDownTarget === event.currentTarget;
    this.backdropMouseDownTarget = null;
    return startedOnBackdrop && event.target === event.currentTarget;
  }

  onCreateAlbumBackdropClick(event: MouseEvent) {
    if (this.backdropPressStartedOnBackdrop(event)) this.closeCreateAlbumModal();
  }

  onEditProfileBackdropClick(event: MouseEvent) {
    if (this.backdropPressStartedOnBackdrop(event)) this.closeEditProfileDialog();
  }

  onReportBackdropClick(event: MouseEvent) {
    if (this.backdropPressStartedOnBackdrop(event)) this.closeReportDialog();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (this.showSafetyMenu() && !target.closest('[data-safety-menu]')) {
      this.showSafetyMenu.set(false);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this.showCreateAlbumModal()) this.closeCreateAlbumModal();
      else if (this.showReportDialog()) this.closeReportDialog();
      else if (this.showEditProfileDialog()) this.closeEditProfileDialog();
      else if (this.showSafetyMenu()) this.showSafetyMenu.set(false);
      else this.activePostMenu.set(null);
      return;
    }

    if (
      event.key === 'Tab' &&
      (this.showCreateAlbumModal() || this.showReportDialog() || this.showEditProfileDialog())
    ) {
      const dialog = document.querySelector<HTMLElement>('[data-profile-dialog="active"]');
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  isOwnProfile() {
    return this.profile()?.viewer.isOwnProfile === true;
  }

  currentState() {
    if (this.activeTab() === 'favorites') return this.favoritesState();
    if (this.activeTab() === 'albums') return this.albumsState();
    return this.postsState();
  }

  formatDate(value: string) {
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));
  }

  trackById(_index: number, item: { id: string }) {
    return item.id;
  }

  private async ensureTabLoaded(tab: ProfileTab) {
    const state = this.stateFor(tab)();
    if (!state.loaded && !state.loading) await this.loadTab(tab);
  }

  private async loadTab(tab: ProfileTab, loadMore = false, force = false) {
    if (!this.canUseTab(tab)) return;
    const stateSignal = this.stateFor(tab) as unknown as WritableSignal<
      TabState<ProfilePin | ProfileAlbum>
    >;
    const current = stateSignal();
    if (current.loading || current.loadingMore) return;
    if (loadMore && !current.hasMore) return;
    if (!loadMore && current.loaded && !force) return;

    const version = this.requestVersion;
    const page = loadMore ? current.page + 1 : 1;
    stateSignal.set({
      ...current,
      loading: !loadMore,
      loadingMore: loadMore,
      error: null,
    });

    try {
      const token = (await this.supabaseService.getSessionToken()) || undefined;
      let response;
      if (tab === 'favorites') {
        if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
        response = await this.userService.getFavorites(page, this.pageSize, token);
      } else if (tab === 'private') {
        if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
        response = await this.userService.getPrivateBoards(page, this.pageSize, token);
      } else if (tab === 'albums') {
        response = await this.userService.getUserAlbums(
          this.currentUsername,
          page,
          this.pageSize,
          token,
        );
      } else {
        response = await this.userService.getUserPosts(
          this.currentUsername,
          page,
          this.pageSize,
          token,
        );
      }
      if (version !== this.requestVersion) return;

      const previousItems = loadMore ? stateSignal().items : [];
      const seen = new Set(previousItems.map((item) => item.id));
      const items = [...previousItems, ...response.items.filter((item) => !seen.has(item.id))];
      stateSignal.set({
        items,
        page: response.page,
        hasMore: response.hasMore,
        loaded: true,
        loading: false,
        loadingMore: false,
        error: null,
      });
      this.setCount(tab, response.total);
    } catch (error) {
      if (version !== this.requestVersion) return;
      stateSignal.update((state) => ({
        ...state,
        loaded: state.items.length > 0,
        loading: false,
        loadingMore: false,
        error: this.errorMessage(error, 'Không thể tải nội dung.'),
      }));
    }
  }

  private activateRequestedTab(tab: ProfileTab) {
    const validTab = this.canUseTab(tab) ? tab : 'posts';
    this.activeTab.set(validTab);
    void this.ensureTabLoaded(validTab);
    if (validTab !== tab) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: validTab },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  private parseTab(raw: string | null): ProfileTab {
    return raw === 'favorites' || raw === 'albums' || raw === 'posts' || raw === 'private' ? raw : 'posts';
  }

  private canUseTab(tab: ProfileTab) {
    if (tab === 'favorites') return this.profile()?.viewer.canViewFavorites === true;
    if (tab === 'private') return this.profile()?.viewer.canViewPrivateBoards === true;
    return true;
  }

  private availableTabs(): ProfileTab[] {
    const tabs: ProfileTab[] = ['posts', 'albums'];
    if (this.canUseTab('favorites')) tabs.push('favorites');
    if (this.canUseTab('private')) tabs.push('private');
    return tabs;
  }

  private stateFor(tab: ProfileTab) {
    if (tab === 'favorites') return this.favoritesState;
    if (tab === 'albums') return this.albumsState;
    if (tab === 'private') return this.privateState;
    return this.postsState;
  }

  private emptyState<T>(): TabState<T> {
    return {
      items: [],
      page: 0,
      hasMore: false,
      loaded: false,
      loading: false,
      loadingMore: false,
      error: null,
    };
  }

  private resetTabStates() {
    this.favoritesState.set(this.emptyState<ProfilePin>());
    this.albumsState.set(this.emptyState<ProfileAlbum>());
    this.postsState.set(this.emptyState<ProfilePin>());
    this.privateState.set(this.emptyState<ProfileAlbum>());
  }

  private countKey(tab: ProfileTab): keyof ProfileSummary['counts'] {
    if (tab === 'albums') return 'albums';
    if (tab === 'private') return 'privateBoards';
    return tab;
  }

  private setCount(tab: ProfileTab, total: number) {
    const key = this.countKey(tab);
    this.updateProfile((current) => ({
      ...current,
      counts: { ...current.counts, [key]: total },
    }));
  }

  private adjustCount(tab: ProfileTab, difference: number) {
    const key = this.countKey(tab);
    this.updateProfile((current) => {
      const currentValue = current.counts[key];
      return {
        ...current,
        counts: {
          ...current.counts,
          [key]: Math.max(0, (currentValue || 0) + difference),
        },
      };
    });
  }

  private updateProfile(update: (profile: ProfileSummary) => ProfileSummary) {
    const current = this.profile();
    if (current) this.profile.set(update(current));
  }

  /** Re-fetches just the permission/relationship state after an action like
   * block/unblock, instead of a full loadProfile() which would also reset
   * and re-fetch the posts/albums/favorites tabs. */
  private async refreshProfileViewerState() {
    const summary = this.profile();
    if (!summary) return;
    try {
      const token = (await this.supabaseService.getSessionToken()) || undefined;
      const fresh = await this.userService.getUserProfile(summary.user.username, token);
      this.updateProfile((current) => ({ ...current, viewer: fresh.viewer }));
    } catch {
      // Best-effort refresh — keep the existing state if this fails.
    }
  }

  private async requireToken() {
    const token = await this.supabaseService.getSessionToken();
    if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
    return token;
  }

  private announce(message: string) {
    this.actionMessage.set(message);
    setTimeout(() => this.actionMessage.set(null), 3500);
  }

  private errorMessage(error: unknown, fallback: string) {
    return toUserMessage(error, fallback);
  }

  private restoreDialogFocus() {
    const target = this.dialogReturnFocus;
    this.dialogReturnFocus = undefined;
    setTimeout(() => target?.focus());
  }
}
