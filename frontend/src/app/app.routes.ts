import { Routes } from '@angular/router';
import { Landing } from './features/landing/landing';
import { Home } from './features/home/home';
import { PinDetail } from './features/pin-detail/pin-detail';
import { Profile } from './features/profile/profile';
import { BoardDetail } from './features/board-detail/board-detail';
import { Create } from './features/create/create';
import { Search } from './features/search/search';
import { Notifications } from './features/notifications/notifications';
import { Settings } from './features/settings/settings';
import { authGuard } from './core/guards/auth';

export const routes: Routes = [
  { path: '', component: Landing },
  { path: 'feed', component: Home, canActivate: [authGuard] },
  { path: 'pin/:id', component: PinDetail, canActivate: [authGuard] },
  { path: 'profile/:username', component: Profile, canActivate: [authGuard] },
  { path: 'board/:id', component: BoardDetail, canActivate: [authGuard] },
  { path: 'create', component: Create, canActivate: [authGuard] },
  { path: 'search', component: Search, canActivate: [authGuard] },
  { path: 'notifications', component: Notifications, canActivate: [authGuard] },
  { path: 'settings', component: Settings, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
