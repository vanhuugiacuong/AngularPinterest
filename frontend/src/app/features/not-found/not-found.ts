import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [],
  templateUrl: './not-found.html',
  styleUrl: './not-found.css'
})
export class NotFound {
  private router = inject(Router);
  public supabaseService = inject(SupabaseService);

  goHome() {
    this.router.navigate([this.supabaseService.user() ? '/feed' : '/']);
  }
}
