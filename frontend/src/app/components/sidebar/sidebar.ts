import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SidebarStateService } from '../../core/services/sidebar-state';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css'
})
export class Sidebar {
  public sidebarState = inject(SidebarStateService);
  private router = inject(Router);

  onZoneEnter(): void {
    this.sidebarState.openSidebar();
  }

  onZoneLeave(): void {
    this.sidebarState.scheduleClose();
  }

  navigateHome(): void {
    this.router.navigate(['/feed']);
  }

  navigateToCreate(): void {
    this.router.navigate(['/create']);
  }

  navigateToMessages(): void {
    this.router.navigate(['/messages']);
  }

  isFeedPage(): boolean {
    return this.router.url === '/feed' || this.router.url === '/';
  }

  isCreatePage(): boolean {
    return this.router.url === '/create';
  }

  isMessagesPage(): boolean {
    return this.router.url.startsWith('/messages');
  }
}
