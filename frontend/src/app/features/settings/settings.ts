import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { SupabaseService } from '../../core/services/supabase';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './settings.html',
  styleUrl: './settings.css'
})
export class Settings {
  public supabaseService = inject(SupabaseService);
  private router = inject(Router);

  async signOut() {
    await this.supabaseService.signOut();
    this.router.navigate(['/']);
  }
}
