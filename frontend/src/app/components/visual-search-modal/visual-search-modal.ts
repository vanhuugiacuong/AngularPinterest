import { Component, inject } from '@angular/core';
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

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.visualSearchService.selectFile(file);
    }
    event.target.value = '';
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.visualSearchService.selectFile(file);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }
}
