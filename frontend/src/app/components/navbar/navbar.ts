import { Component, inject, signal, ElementRef, HostListener, Output, EventEmitter, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css'
})
export class Navbar {
  public supabaseService = inject(SupabaseService);
  private router = inject(Router);
  private elementRef = inject(ElementRef);

  @Output() loginClick = new EventEmitter<void>();
  @ViewChild('bottomNavEl') bottomNavEl?: ElementRef;

  public showProfilePopup = signal(false);
  public isNavExpanded = signal(false);

  private collapseTimer: any = null;
  private longPressTimer: any = null;
  private longPressTriggered = false;

  toggleProfilePopup(event: MouseEvent) {
    event.stopPropagation();
    this.showProfilePopup.update(val => !val);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!this.elementRef.nativeElement.contains(target)) {
      this.showProfilePopup.set(false);
    }
    if (this.bottomNavEl && !this.bottomNavEl.nativeElement.contains(target)) {
      this.isNavExpanded.set(false);
    }
  }

  // Desktop: hover over the bottom nav fans the icons out
  onNavMouseEnter() {
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    this.isNavExpanded.set(true);
  }

  onNavMouseLeave() {
    this.collapseTimer = setTimeout(() => this.isNavExpanded.set(false), 200);
  }

  // Mobile: press and hold the Home button to fan the icons out
  onHomeTouchStart() {
    this.longPressTriggered = false;
    this.longPressTimer = setTimeout(() => {
      this.longPressTriggered = true;
      this.isNavExpanded.set(true);
    }, 350);
  }

  onHomeTouchEnd() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  onHomeClick() {
    // Swallow the click that follows a long-press touch (it already opened the fan)
    if (this.longPressTriggered) {
      this.longPressTriggered = false;
      return;
    }
    this.onLogoClick();
    this.isNavExpanded.set(false);
  }

  collapseNav() {
    this.isNavExpanded.set(false);
  }

  onLoginClick() {
    this.loginClick.emit();
  }

  onLogoClick() {
    if (this.supabaseService.user()) {
      this.router.navigate(['/feed']);
    } else {
      this.router.navigate(['/']);
    }
  }

  navigateToMyProfile() {
    const dbUser = this.supabaseService.dbUser();
    if (dbUser && dbUser.username) {
      this.router.navigate(['/profile', dbUser.username]);
    } else {
      const user = this.supabaseService.user();
      if (user) {
        const email = user.email || '';
        const username = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || email.split('@')[0];
        this.router.navigate(['/profile', username]);
      }
    }
    this.showProfilePopup.set(false);
    this.collapseNav();
  }

  navigateToCreate() {
    this.router.navigate(['/create']);
    this.collapseNav();
  }

  navigateToExplore() {
    this.router.navigate(['/feed'], { queryParams: { sort: 'trending' } });
    this.collapseNav();
  }

  navigateToNotifications() {
    this.router.navigate(['/notifications']);
    this.collapseNav();
  }

  navigateToSettings() {
    this.showProfilePopup.set(false);
    this.router.navigate(['/settings']);
  }

  onSearchSubmit(event: Event) {
    const input = event.target as HTMLInputElement;
    const q = input.value.trim();
    this.router.navigate(['/search'], { queryParams: q ? { q } : {} });
  }

  async signOut() {
    await this.supabaseService.signOut();
    this.router.navigate(['/']);
  }

  isProfilePage(): boolean {
    return this.router.url.includes('/profile');
  }

  isFeedPage(): boolean {
    return this.router.url === '/feed' || this.router.url === '/';
  }

  isCreatePage(): boolean {
    return this.router.url === '/create';
  }

  isExplorePage(): boolean {
    return this.router.url.startsWith('/feed') && this.router.url.includes('sort=trending');
  }

  isNotificationsPage(): boolean {
    return this.router.url.startsWith('/notifications');
  }
}
