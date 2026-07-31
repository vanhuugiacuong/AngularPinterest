import { Component, inject, signal, ElementRef, HostListener, Output, EventEmitter } from '@angular/core';
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

  public showProfilePopup = signal(false);

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
