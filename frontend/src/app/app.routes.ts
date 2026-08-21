import { Routes } from '@angular/router';
import { Landing } from './features/landing/landing';
import { Home } from './features/home/home';
import { PinDetail } from './features/pin-detail/pin-detail';
import { Profile } from './features/profile/profile';
import { BoardDetail } from './features/board-detail/board-detail';
import { Create } from './features/create/create';
import { Messages } from './features/messages/messages';
import { authGuard } from './core/guards/auth';
import { Pricing } from './features/pricing/pricing';

export const routes: Routes = [
  { path: '', component: Landing },
  { path: 'feed', component: Home, canActivate: [authGuard] },
  { path: 'pin/:id', component: PinDetail, canActivate: [authGuard] },
  { path: 'profile/:username', component: Profile, canActivate: [authGuard] },
  { path: 'board/:id', component: BoardDetail, canActivate: [authGuard] },
  { path: 'create', component: Create, canActivate: [authGuard] },
  { path: 'pricing', component: Pricing, canActivate: [authGuard] },
  { path: 'messages', component: Messages, canActivate: [authGuard] },
  { path: 'messages/:conversationId', component: Messages, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
