import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SidebarStateService {
  /** false means the compact rail remains visible; true shows its labels. */
  public readonly isExpanded = signal(false);

  expandSidebar(): void {
    this.isExpanded.set(true);
  }

  collapseSidebar(): void {
    this.isExpanded.set(false);
  }

  toggleSidebar(): void {
    this.isExpanded.update((expanded) => !expanded);
  }
}
