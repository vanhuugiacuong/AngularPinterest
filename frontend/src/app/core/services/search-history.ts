import { Injectable, signal } from '@angular/core';

/** Recent keyword searches shown in the navbar's empty-query dropdown
 * ("Tìm kiếm gần đây"). The project has no backend table for this, so it is
 * kept in localStorage per browser, scoped to a single key — consistent
 * with how SupabaseService/other client-only state is handled here. */
@Injectable({ providedIn: 'root' })
export class SearchHistoryService {
  private static readonly STORAGE_KEY = 'novaframe:recent-searches';
  private static readonly MAX_ITEMS = 8;

  public readonly recentSearches = signal<string[]>(this.readFromStorage());

  add(term: string): void {
    const trimmed = term.trim();
    if (!trimmed) return;

    const withoutDuplicate = this.recentSearches().filter(
      (t) => t.toLowerCase() !== trimmed.toLowerCase(),
    );
    const updated = [trimmed, ...withoutDuplicate].slice(0, SearchHistoryService.MAX_ITEMS);
    this.recentSearches.set(updated);
    this.writeToStorage(updated);
  }

  remove(term: string): void {
    const updated = this.recentSearches().filter((t) => t !== term);
    this.recentSearches.set(updated);
    this.writeToStorage(updated);
  }

  clear(): void {
    this.recentSearches.set([]);
    this.writeToStorage([]);
  }

  private readFromStorage(): string[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SearchHistoryService.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
    } catch {
      return [];
    }
  }

  private writeToStorage(items: string[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SearchHistoryService.STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full/unavailable (private browsing, quota) — recent
      // searches are a convenience, not worth surfacing an error for.
    }
  }
}
