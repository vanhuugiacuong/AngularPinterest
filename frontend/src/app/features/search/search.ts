import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { ChatService, PublicUserSummary } from '../../core/services/chat';
import { SupabaseService } from '../../core/services/supabase';

// Lowercases and strips Vietnamese diacritics (tone marks via NFD decomposition, plus
// đ/Đ which don't decompose that way) so "cho" matches "chó" the same way real
// Pinterest's search tolerates missing accents.
function normalizeForSearch(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './search.html',
  styleUrl: './search.css'
})
export class Search implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pinService = inject(PinService);
  private chatService = inject(ChatService);
  private supabaseService = inject(SupabaseService);

  public query = signal<string>('');
  public results = signal<any[]>([]);
  public userResults = signal<PublicUserSummary[]>([]);
  public isLoading = signal<boolean>(true);

  ngOnInit() {
    this.route.queryParamMap.subscribe(params => {
      const q = params.get('q') || '';
      this.query.set(q);
      this.runSearch(q);
    });
  }

  async runSearch(q: string) {
    this.isLoading.set(true);
    try {
      const [pins] = await Promise.all([this.loadAllPins(), this.loadMatchingUsers(q)]);
      const needle = normalizeForSearch(q.trim());
      const filtered = needle
        ? pins.filter(p =>
            normalizeForSearch(p.title).includes(needle) ||
            normalizeForSearch(p.description).includes(needle) ||
            normalizeForSearch(p.user?.username).includes(needle)
          )
        : pins;
      // Most-liked first, same ordering the home feed's "trending" sort uses —
      // otherwise results come back in whatever order the DB happens to return them.
      filtered.sort((a, b) => ((b as any)._count?.likes ?? 0) - ((a as any)._count?.likes ?? 0));
      this.results.set(filtered);
    } catch (error) {
      console.error('Error searching pins:', error);
      this.results.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadMatchingUsers(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      this.userResults.set([]);
      return;
    }
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) {
        this.userResults.set([]);
        return;
      }
      this.userResults.set(await this.chatService.searchUsers(trimmed, token));
    } catch (error) {
      console.error('Error searching users:', error);
      this.userResults.set([]);
    }
  }

  // Was only checking the first 60 pins — a match further down the list (there can be
  // hundreds) would silently never show up. Pages through everything instead, same
  // "fewer than a full page = done" stopping rule used elsewhere in the app.
  private async loadAllPins() {
    const pageSize = 60;
    let page = 1;
    const all: any[] = [];
    while (true) {
      const pins = await this.pinService.getPins(page, pageSize);
      if (!pins || pins.length === 0) break;
      all.push(...pins);
      if (pins.length < pageSize) break;
      page++;
    }
    return all;
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  navigateToUser(username: string) {
    this.router.navigate(['/profile', username]);
  }
}
