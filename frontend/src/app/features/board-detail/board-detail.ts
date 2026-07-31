import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { BoardService } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';

@Component({
  selector: 'app-board-detail',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './board-detail.html',
  styleUrl: './board-detail.css'
})
export class BoardDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private boardService = inject(BoardService);
  public supabaseService = inject(SupabaseService);

  public board = signal<any | null>(null);
  public pins = signal<any[]>([]);
  public isLoading = signal<boolean>(true);

  async ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.loadBoardDetail(id);
      }
    });
  }

  async loadBoardDetail(id: string) {
    this.isLoading.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const boardData = await this.boardService.getBoardById(id, token);
        this.board.set(boardData);
        
        const boardPinsList = boardData.boardPins || [];
        const pinsList = boardPinsList.map((bp: any) => ({
          id: bp.pin.id,
          title: bp.pin.title,
          image: bp.pin.imageUrl,
          isAiGenerated: bp.pin.isAiGenerated
        }));
        
        this.pins.set(pinsList);
      }
    } catch (error) {
      console.error('Error loading board detail:', error);
      this.router.navigate(['/feed']);
    } finally {
      this.isLoading.set(false);
    }
  }

  goBackToProfile() {
    const profileUser = this.supabaseService.user();
    if (profileUser) {
      const email = profileUser.email || '';
      const username = profileUser.user_metadata?.['full_name'] || profileUser.user_metadata?.['name'] || email.split('@')[0];
      this.router.navigate(['/profile', username]);
    } else {
      this.router.navigate(['/feed']);
    }
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  async removePin(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    const currentBoard = this.board();
    if (!currentBoard) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        await this.boardService.removePinFromBoard(currentBoard.id, pinId, token);
        this.pins.update(curr => curr.filter(p => p.id !== pinId));
      }
    } catch (error) {
      console.error('Error removing pin from board:', error);
    }
  }
}
