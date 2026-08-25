import { Component, input, output } from '@angular/core';

/**
 * Shared animated like control. The caller owns the persisted like state;
 * this component only renders it and emits the activating pointer event.
 */
@Component({
  selector: 'app-like-button',
  standalone: true,
  templateUrl: './like-button.html',
  styleUrl: './like-button.css',
})
export class LikeButton {
  liked = input(false);
  count = input<number | null>(null);
  size = input<'compact' | 'default'>('default');
  ariaLabel = input('Thích');
  disabled = input(false);

  toggled = output<MouseEvent>();

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.disabled()) return;
    this.toggled.emit(event);
  }
}
