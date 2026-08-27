import { Routes } from '@angular/router';
import { Landing } from './features/landing/landing';
import { Home } from './features/home/home';
import { PinDetail } from './features/pin-detail/pin-detail';
import { Profile } from './features/profile/profile';
import { BoardDetail } from './features/board-detail/board-detail';
import { BoardOrganize } from './features/board-organize/board-organize';
import { BoardIdeas } from './features/board-ideas/board-ideas';
import { Create } from './features/create/create';
import { Search } from './features/search/search';
import { Notifications } from './features/notifications/notifications';
import { Settings } from './features/settings/settings';
import { NotFound } from './features/not-found/not-found';
import { Chat } from './features/chat/chat';
import { Pro } from './features/pro/pro';
import { Wallet } from './features/wallet/wallet';
import { BillingResult } from './features/billing-result/billing-result';
import { Admin } from './features/admin/admin';
import { authGuard } from './core/guards/auth';

export const routes: Routes = [
  { path: '', component: Landing },
  // TEMP: authGuard disabled for local preview only — restore before shipping
  { path: 'feed', component: Home },
  { path: 'pin/:id', component: PinDetail },
  { path: 'profile/:username', component: Profile },
  { path: 'board/:id/organize', component: BoardOrganize },
  { path: 'board/:id/ideas', component: BoardIdeas },
  { path: 'board/:id', component: BoardDetail },
  { path: 'create', component: Create },
  // Lazy-loaded on its own route: the editor pulls in fabric plus the
  // segmentation models, and no other page needs that weight.
  {
    path: 'collage',
    loadComponent: () => import('./features/collage/collage').then((m) => m.Collage),
  },
  { path: 'search', component: Search },
  { path: 'notifications', component: Notifications },
  { path: 'settings', component: Settings },
  { path: 'pro', component: Pro },
  { path: 'wallet', component: Wallet },
  { path: 'billing/result', component: BillingResult },
  { path: 'admin', component: Admin },
  { path: 'chat', component: Chat },
  { path: 'chat/:conversationId', component: Chat },
  { path: '**', component: NotFound }
];
