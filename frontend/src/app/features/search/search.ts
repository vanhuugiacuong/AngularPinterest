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
  public refinementTags = signal<{ label: string; imageUrl: string | null }[]>([]);

  // Rough Vietnamese stop-word list (diacritic-stripped) so common filler words never
  // show up as a "related" tag — this is a best-effort heuristic, not a real dictionary.
  private readonly stopWords = new Set([
    'va', 'la', 'cua', 'cho', 'cac', 'mot', 'nhung', 'co', 'khong', 'nay', 'do', 'voi',
    'trong', 'tren', 'de', 'khi', 'se', 'da', 'thi', 'ma', 'nhu', 'vi', 'nen', 'hay',
    'hoac', 'roi', 'sau', 'truoc', 'tu', 'den', 'theo', 'duoc', 'bi', 'rat', 'qua', 'it',
    'nhieu', 'moi', 'tat', 'ca', 'nguoi', 'minh', 'ban', 'anh', 'chi', 'em', 'toi', 'nhe',
  ]);

  private readonly pillPalette = [
    'bg-[#F9D9E7] dark:bg-[#3a2530]',
    'bg-[#D9E9F9] dark:bg-[#20303f]',
    'bg-[#DFF3D9] dark:bg-[#243422]',
    'bg-[#FBE7C6] dark:bg-[#3a3020]',
    'bg-[#E6D9F9] dark:bg-[#2e2440]',
    'bg-[#F9E0D9] dark:bg-[#3a2820]',
    'bg-[#D9F9F3] dark:bg-[#1f3a35]',
    'bg-[#F9F3D9] dark:bg-[#38371f]',
  ];

  pillColorClass(i: number): string {
    return this.pillPalette[i % this.pillPalette.length];
  }

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
      // Match each word of the query independently (AND, not one literal phrase) so a
      // combined query from a refinement tag — e.g. "chó" + "cưng" — still finds pins
      // whose title has both words but not necessarily next to each other.
      const needleWords = normalizeForSearch(q.trim()).split(/\s+/).filter(Boolean);
      const filtered = needleWords.length
        ? pins.filter(p => {
            const haystack = [
              normalizeForSearch(p.title),
              normalizeForSearch(p.description),
              normalizeForSearch(p.user?.username),
            ].join(' ');
            return needleWords.every(w => haystack.includes(w));
          })
        : pins;
      // Most-liked first, same ordering the home feed's "trending" sort uses —
      // otherwise results come back in whatever order the DB happens to return them.
      filtered.sort((a, b) => ((b as any)._count?.likes ?? 0) - ((a as any)._count?.likes ?? 0));
      this.results.set(filtered);
      this.refinementTags.set(needleWords.length ? this.computeRefinementTags(filtered, needleWords) : []);
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

  // "Gợi ý bộ lọc" (guided search pills) — a lightweight stand-in for Pinterest's
  // AI co-occurrence tags. Real Pinterest pulls these from words that show up on other
  // boards/pins saved alongside the ones you're looking at — including plenty that look
  // unrelated on their own. We don't have that saved-together data, so we approximate it
  // by pulling words from title + description + uploader name across every matched pin,
  // which casts a wide enough net to include some "unrelated" ones the same way.
  private computeRefinementTags(pins: any[], needleWords: string[]): { label: string; imageUrl: string | null }[] {
    const counts = new Map<string, { label: string; count: number; imageUrl: string | null }>();
    for (const pin of pins) {
      const text = [pin.title, pin.description, pin.user?.username].filter(Boolean).join(' ');
      if (!text.trim()) continue;
      for (const raw of text.split(/\s+/)) {
        const word = raw.replace(/[^\p{L}\p{N}]/gu, '');
        if (word.length < 2) continue;
        const key = normalizeForSearch(word);
        if (!key || needleWords.includes(key) || this.stopWords.has(key)) continue;
        const existing = counts.get(key);
        if (existing) {
          existing.count++;
        } else {
          counts.set(key, { label: word, count: 1, imageUrl: pin.imageUrl ?? null });
        }
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
  }

  applyRefinementTag(tag: string) {
    const current = this.query().trim();
    const combined = current ? `${current} ${tag}` : tag;
    this.router.navigate(['/search'], { queryParams: { q: combined } });
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  navigateToUser(username: string) {
    this.router.navigate(['/profile', username]);
  }
}
