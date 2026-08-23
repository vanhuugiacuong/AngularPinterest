import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { UserService } from '../../core/services/user';
import { BoardService } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.css'
})
export class Profile implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userService = inject(UserService);
  private boardService = inject(BoardService);
  private toastService = inject(ToastService);
  public supabaseService = inject(SupabaseService);

  public userProfile = signal<any | null>(null);
  public isLoading = signal<boolean>(true);
  public activeTab = signal<'boards' | 'created'>('boards');

  // New board modal properties
  public showCreateBoardModal = signal<boolean>(false);
  public newBoardName = '';
  public newBoardDesc = '';
  public newBoardSecret = false;
  public isSubmittingBoard = false;

  async ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const username = params.get('username');
      if (username) {
        this.loadProfile(username);
      }
    });
  }

  async loadProfile(username: string) {
    this.isLoading.set(true);
    try {
      const profile = await this.userService.getUserProfile(username);
      
      const currentUser = this.supabaseService.user();
      const isCurrentUser = currentUser && (currentUser.email === profile.email);
      
      if (isCurrentUser) {
        try {
          const token = await this.supabaseService.getSessionToken();
          if (token) {
            const allBoards = await this.boardService.getBoards(token);
            profile.boards = allBoards;
          }
        } catch (boardError) {
          console.error('Error fetching boards for user profile:', boardError);
          profile.boards = [];
        }
      }

      this.userProfile.set(profile);
    } catch (error) {
      console.error('Error loading user profile:', error);
      this.toastService.error(`Không tìm thấy trang cá nhân "${username}".`);
      this.router.navigate(['/feed']);
    } finally {
      this.isLoading.set(false);
    }
  }

  isMyProfile(): boolean {
    const profile = this.userProfile();
    const currentUser = this.supabaseService.user();
    if (!profile || !currentUser) return false;
    return currentUser.email === profile.email;
  }

  getBoardPreviews(board: any): string[] {
    const list = board.boardPins || [];
    return list.slice(0, 3).map((bp: any) => bp.pin?.imageUrl).filter(Boolean);
  }

  getSavedPins(): any[] {
    const profile = this.userProfile();
    if (!profile) return [];
    
    const savedMap = new Map<string, any>();
    const boards = profile.boards || [];
    for (const board of boards) {
      const boardPins = board.boardPins || [];
      for (const bp of boardPins) {
        if (bp.pin) {
          savedMap.set(bp.pin.id, {
            id: bp.pin.id,
            title: bp.pin.title,
            imageUrl: bp.pin.imageUrl,
            isAiGenerated: bp.pin.isAiGenerated
          });
        }
      }
    }
    
    return Array.from(savedMap.values());
  }

  setTab(tab: 'boards' | 'created') {
    this.activeTab.set(tab);
  }

  navigateToBoard(boardId: string) {
    this.router.navigate(['/board', boardId]);
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  openCreateBoardModal() {
    this.showCreateBoardModal.set(true);
    this.newBoardName = '';
    this.newBoardDesc = '';
    this.newBoardSecret = false;
  }

  closeCreateBoardModal() {
    this.showCreateBoardModal.set(false);
  }

  async createBoard() {
    if (!this.newBoardName.trim()) return;
    this.isSubmittingBoard = true;
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const newBoard = await this.boardService.createBoard(
          this.newBoardName.trim(),
          this.newBoardDesc.trim(),
          this.newBoardSecret,
          token
        );
        
        const profile = this.userProfile();
        if (profile) {
          const updatedBoards = [newBoard, ...(profile.boards || [])];
          this.userProfile.set({ ...profile, boards: updatedBoards });
        }
        this.closeCreateBoardModal();
        this.toastService.success('Tạo bảng thành công!');
      }
    } catch (error) {
      console.error('Error creating board:', error);
      this.toastService.error('Lỗi khi tạo bảng.');
    } finally {
      this.isSubmittingBoard = false;
    }
  }

  async toggleFollow() {
    const profile = this.userProfile();
    const currentUser = this.supabaseService.user();
    if (!profile || !currentUser || this.isMyProfile()) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        await this.userService.toggleFollow(profile.id, token);
        this.loadProfile(profile.username);
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    }
  }
}
