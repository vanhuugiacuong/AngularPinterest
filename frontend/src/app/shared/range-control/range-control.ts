import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Label + live value readout + slider + reset, aligned on one row — the
 * repeated shape behind every adjustment slider in the image editor (color
 * sliders, caption size/opacity/etc). `liveChange` fires on every drag tick
 * (for live preview); `commit` fires once on release (for undo/redo history).
 */
let nextId = 0;

@Component({
  selector: 'app-range-control',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './range-control.html',
  styleUrl: './range-control.css',
})
export class RangeControl {
  public readonly inputId = `range-control-${nextId++}`;

  @Input() label = '';
  @Input({ required: true }) value!: number;
  @Input() min = 0;
  @Input() max = 100;
  @Input() step = 1;
  @Input() unit = '';
  @Input() disabled = false;
  @Input() showReset = true;

  @Output() liveChange = new EventEmitter<number>();
  @Output() commit = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.liveChange.emit(value);
  }

  onChange(): void {
    this.commit.emit();
  }

  onReset(): void {
    this.reset.emit();
  }
}
