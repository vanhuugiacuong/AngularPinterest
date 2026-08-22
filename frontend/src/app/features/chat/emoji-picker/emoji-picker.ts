import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMOJI_CATEGORIES, EmojiEntry } from './emoji-data';

@Component({
  selector: 'app-emoji-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './emoji-picker.html',
  styleUrl: './emoji-picker.css',
})
export class EmojiPicker {
  private readonly elementRef = inject(ElementRef);

  @Output() emojiSelected = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  readonly categories = EMOJI_CATEGORIES;
  readonly activeCategoryId = signal(EMOJI_CATEGORIES[0].id);
  readonly query = signal('');

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.closed.emit();
    }
  }

  selectCategory(id: string) {
    this.activeCategoryId.set(id);
  }

  visibleEmojis(): EmojiEntry[] {
    const q = this.query().trim().toLowerCase();
    if (q) {
      const results: EmojiEntry[] = [];
      for (const category of this.categories) {
        for (const emoji of category.emojis) {
          if (emoji.keywords.some((k) => k.includes(q))) results.push(emoji);
        }
      }
      return results;
    }
    return this.categories.find((c) => c.id === this.activeCategoryId())?.emojis ?? [];
  }

  pick(emoji: EmojiEntry, event: MouseEvent) {
    event.stopPropagation();
    this.emojiSelected.emit(emoji.char);
  }

  trackByChar(_index: number, item: EmojiEntry) {
    return item.char;
  }
}
