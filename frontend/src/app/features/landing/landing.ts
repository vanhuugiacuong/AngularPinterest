import { Component, inject, signal, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase';
import { Navbar } from '../../components/navbar/navbar';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './landing.html',
  styleUrl: './landing.css'
})
export class Landing implements OnInit {
  private supabaseService = inject(SupabaseService);
  public showLoginModal = signal<boolean>(false);
  public errorMsg = signal<string | null>(null);

  ngOnInit() {
    // Check if there is an auth error in the URL (redirected back from failed Google OAuth)
    const searchParams = new URLSearchParams(window.location.search);
    let errorDescription = searchParams.get('error_description');

    if (!errorDescription && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      errorDescription = hashParams.get('error_description');
    }

    if (errorDescription) {
      this.errorMsg.set(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
      this.showLoginModal.set(true); // Open the modal automatically to show the error
    }
  }

  openLoginModal() {
    this.errorMsg.set(null);
    this.showLoginModal.set(true);
  }

  closeLoginModal() {
    this.showLoginModal.set(false);
    this.errorMsg.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.showLoginModal()) {
      this.closeLoginModal();
    }
  }

  async login() {
    try {
      this.errorMsg.set(null);
      await this.supabaseService.signInWithGoogle();
    } catch (err: any) {
      this.errorMsg.set(err.message || 'Có lỗi xảy ra khi kết nối tới Google OAuth.');
    }
  }
}
