import { Routes } from '@angular/router';
import { Landing } from './features/landing/landing';
import { Home } from './features/home/home';
import { PinDetail } from './features/pin-detail/pin-detail';
import { NotFound } from './features/not-found/not-found';
import { authGuard } from './core/guards/auth';

/**
 * Trang nào EAGER, trang nào LAZY.
 *
 * Eager = nạp kèm bundle đầu tiên: chỉ dành cho đường đi hằng ngày (xem feed,
 * mở ảnh, hồ sơ, đăng ảnh, tìm kiếm, nhắn tin, thông báo). Người dùng gần như
 * chắc chắn vào những trang này nên tách ra chỉ tổ thêm một lượt tải.
 *
 * Lazy = tách gói riêng, chỉ tải khi thật sự mở: trang ít dùng hoặc nặng.
 * Nặng nhất là khu quản trị — riêng `admin.css` đã 19kB, gấp 2.4 lần ngưỡng
 * cho phép, mà chỉ đúng hai tài khoản admin mở tới. Nhóm thanh toán (Pro, ví,
 * kết quả giao dịch) cũng vậy: kéo theo cả logic QR/billing mà đa số người
 * dùng không bao giờ chạm.
 *
 * Vì sao phải làm: `ng build` production THẤT BẠI do bundle vượt ngưỡng
 * (1.80MB > 1.40MB). Nới ngưỡng trong angular.json thì chỉ giấu triệu chứng —
 * mọi người vẫn phải tải code của trang họ không dùng.
 */
export const routes: Routes = [
  // Trang giới thiệu: KHÔNG chặn — đây là chỗ người chưa đăng nhập rơi vào.
  { path: '', component: Landing },
  { path: 'feed', component: Home, canActivate: [authGuard] },
  { path: 'pin/:id', component: PinDetail, canActivate: [authGuard] },

  // ── Lazy: điểm đến riêng ─────────────────────────────────────────────────
  // Đều là trang người dùng CHỦ ĐỘNG bấm để tới, không phải màn hình đầu tiên,
  // nên chịu thêm một lượt tải nhỏ lúc mở lần đầu là chấp nhận được — đổi lại
  // ai chỉ lướt feed thì không phải tải code của chúng.
  {
    path: 'profile/:username',
    loadComponent: () => import('./features/profile/profile').then((m) => m.Profile),
    canActivate: [authGuard],
  },
  {
    path: 'board/:id',
    loadComponent: () => import('./features/board-detail/board-detail').then((m) => m.BoardDetail),
    canActivate: [authGuard],
  },
  // Trang đăng ảnh kéo theo hai trình sửa ảnh (edit-image, crop-image).
  {
    path: 'create',
    loadComponent: () => import('./features/create/create').then((m) => m.Create),
    canActivate: [authGuard],
  },
  {
    path: 'search',
    loadComponent: () => import('./features/search/search').then((m) => m.Search),
    canActivate: [authGuard],
  },
  {
    path: 'notifications',
    loadComponent: () => import('./features/notifications/notifications').then((m) => m.Notifications),
    canActivate: [authGuard],
  },
  // Nhắn tin kéo theo realtime + bộ chọn GIF.
  {
    path: 'chat',
    loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
    canActivate: [authGuard],
  },
  {
    path: 'chat/:conversationId',
    loadComponent: () => import('./features/chat/chat').then((m) => m.Chat),
    canActivate: [authGuard],
  },

  // ── Lazy ────────────────────────────────────────────────────────────────
  // Trình sửa ảnh ghép: kéo theo fabric + mô hình tách nền, không trang nào khác cần.
  {
    path: 'collage',
    loadComponent: () => import('./features/collage/collage').then((m) => m.Collage),
    canActivate: [authGuard],
  },
  {
    path: 'board/:id/organize',
    loadComponent: () => import('./features/board-organize/board-organize').then((m) => m.BoardOrganize),
    canActivate: [authGuard],
  },
  {
    path: 'board/:id/ideas',
    loadComponent: () => import('./features/board-ideas/board-ideas').then((m) => m.BoardIdeas),
    canActivate: [authGuard],
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
    canActivate: [authGuard],
  },
  // Nhóm thanh toán
  {
    path: 'pro',
    loadComponent: () => import('./features/pro/pro').then((m) => m.Pro),
    canActivate: [authGuard],
  },
  {
    path: 'wallet',
    loadComponent: () => import('./features/wallet/wallet').then((m) => m.Wallet),
    canActivate: [authGuard],
  },
  {
    path: 'billing/result',
    loadComponent: () => import('./features/billing-result/billing-result').then((m) => m.BillingResult),
    canActivate: [authGuard],
  },
  // Khu quản trị — nặng nhất, ít người mở nhất.
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/admin').then((m) => m.Admin),
    canActivate: [authGuard],
  },
  {
    path: 'banned',
    loadComponent: () => import('./features/banned/banned').then((m) => m.Banned),
  },

  { path: '**', component: NotFound },
];
