import { Component, inject, signal, ElementRef, HostListener, Output, EventEmitter, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase';
import { SidebarStateService } from '../../core/services/sidebar-state';
import { Sidebar } from '../sidebar/sidebar';
import { UserAvatar } from '../../shared/user-avatar/user-avatar';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule, Sidebar, UserAvatar],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css'
})
export class Navbar {
  public supabaseService = inject(SupabaseService);
  public sidebarState = inject(SidebarStateService);
  private router = inject(Router);
  private elementRef = inject(ElementRef);

  @Output() loginClick = new EventEmitter<void>();
  /** Emits the trimmed query on Enter / clear. Pages that care (e.g. /feed)
   * bind to it; pages that don't simply leave it unheard. */
  @Output() search = new EventEmitter<string>();

  @ViewChild('sidebarTrigger') sidebarTrigger?: ElementRef<HTMLButtonElement>;

  public showProfilePopup = signal(false);
  public searchQuery = signal('');

  /** Best available avatar URL: synced DB profile picture first (persists
   * across providers/sessions), then the raw OAuth metadata as a fallback
   * for the brief window before the backend sync completes. */
  avatarUrl(): string | null {
    const dbAvatar = this.supabaseService.dbUser()?.avatarUrl;
    if (dbAvatar) return dbAvatar;
    const user = this.supabaseService.user();
    return user?.user_metadata?.['avatar_url'] || user?.user_metadata?.['picture'] || null;
  }

  displayName(): string {
    const dbName = this.supabaseService.dbUser()?.username;
    if (dbName) return dbName;
    const user = this.supabaseService.user();
    if (!user) return '';
    return (
      user.user_metadata?.['full_name'] ||
      user.user_metadata?.['name'] ||
      user.email?.split('@')[0] ||
      ''
    );
  }

  onSearchInput(value: string) {
    this.searchQuery.set(value);
  }

  submitSearch() {
    this.search.emit(this.searchQuery().trim());
  }

  clearSearch() {
    this.searchQuery.set('');
    this.search.emit('');
  }

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
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.sidebarState.isOpen()) {
      this.sidebarState.close();
      this.sidebarTrigger?.nativeElement.focus();
    }
  }

  onSidebarTriggerEnter() {
    this.sidebarState.cancelClose();
    this.sidebarState.openSidebar();
  }

  onSidebarTriggerLeave() {
    this.sidebarState.scheduleClose();
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
  }

  navigateToCreate() {
    this.router.navigate(['/create']);
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
}
