import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PinService, Pin } from '../../core/services/pin';
import { BoardService } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { PinCardActionsService } from '../../core/services/pin-card-actions';

@Component({
  selector: 'app-board-ideas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './board-ideas.html',
  styleUrl: './board-ideas.css',
})
export class BoardIdeas implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  private supabaseService = inject(SupabaseService);
  private toastService = inject(ToastService);

  private boardId = '';
  public ideaPins = signal<Pin[]>([]);
  public isLoading = signal(true);
  /* Saved state comes from the shared service, so a pin saved here shows as
     saved on the feed and under the pin too. The SAVE ITSELF stays local: this
     page adds to one specific board (the one being viewed), with no picker and
     no default-board fallback, which is a different flow from a card's save
     rather than another copy of it. */
  public readonly cardActions = inject(PinCardActionsService);
  public savingPinId = signal<string | null>(null);

  async ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.boardId = id;
        this.loadIdeas();
      }
    });
  }

  // Same "load everything the home feed would eventually show" pattern used by the
  // collage editor's own "Ý tưởng" tab — there's no dedicated recommendation endpoint,
  // so this reuses the general feed as the idea pool.
  private async loadIdeas() {
    this.isLoading.set(true);
    const pageSize = 20;
    let page = 1;
    const all: Pin[] = [];
    try {
      // Fetch every page before rendering any of it — setting ideaPins() after each page
      // (like the collage editor's own idea tab does) made the CSS masonry columns
      // constantly re-flow as new items arrived, visually "shoving" already-visible
      // images to a different spot. One single set() at the end avoids that reflow.
      while (page <= 5) {
        const pins = await this.pinService.getPins(page, pageSize);
        if (!pins || pins.length === 0) break;
        all.push(...pins);
        if (pins.length < pageSize) break;
        page++;
      }
      this.ideaPins.set(all);
    } catch (error) {
      console.error('Error loading idea pins for board:', error);
      this.toastService.error('Không tải được ý tưởng.');
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/board', this.boardId]);
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  isSaved(pinId: string): boolean {
    return this.cardActions.isSaved(pinId);
  }

  async saveToBoard(pin: Pin, event: Event) {
    event.stopPropagation();
    if (this.isSaved(pin.id) || this.savingPinId()) return;

    this.savingPinId.set(pin.id);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) {
        this.toastService.error('Bạn cần đăng nhập để lưu Ghim.');
        return;
      }
      await this.boardService.addPinToBoard(this.boardId, pin.id, token);
      this.cardActions.markSaved(pin.id);
      this.toastService.success('Đã lưu vào bảng!');
    } catch (error) {
      console.error('Error saving idea pin to board:', error);
      this.toastService.error('Không thể lưu Ghim này.');
    } finally {
      this.savingPinId.set(null);
    }
  }
}
