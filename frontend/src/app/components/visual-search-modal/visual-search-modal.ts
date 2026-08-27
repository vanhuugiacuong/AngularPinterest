import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VisualSearchService } from '../../core/services/visual-search';

@Component({
  selector: 'app-visual-search-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './visual-search-modal.html',
  styleUrl: './visual-search-modal.css'
})
export class VisualSearchModal {
  public visualSearchService = inject(VisualSearchService);

  /** true khi đang rê file lên vùng thả — đổi viền/nền cho thấy rõ thả được. */
  public isDraggingOver = signal(false);

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.visualSearchService.selectFile(file);
    }
    event.target.value = '';
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDraggingOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.visualSearchService.selectFile(file);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDraggingOver.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDraggingOver.set(false);
  }
}
