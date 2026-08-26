import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
} from '@angular/core';

export interface CropBox {
  /** all 0..1 fractions of the framed element */
  x: number;
  y: number;
  width: number;
  height: number;
}

type Handle = 'move' | 'nw' | 'ne' | 'se' | 'sw';

const MIN = 0.05; // smallest allowed box side, as a fraction

/**
 * A lightweight crop selection layer, meant to be placed as an absolute overlay
 * directly on top of an image (`position: absolute; inset: 0`).
 *
 * Chrome: everything outside the box is dimmed (box-shadow trick), the box has
 * four thin translucent corner brackets, and the whole box is draggable to move.
 * It emits `boxChange` on every pointer move (for live rendering) and `commit`
 * on pointer-up (that's when the parent should run the search).
 */
@Component({
  selector: 'app-image-cropper',
  standalone: true,
  templateUrl: './image-cropper.html',
  styleUrl: './image-cropper.css',
})
export class ImageCropper {
  @Input({ required: true }) box!: CropBox;
  @Output() boxChange = new EventEmitter<CropBox>();
  @Output() commit = new EventEmitter<CropBox>();

  @ViewChild('frame', { static: true }) frame!: ElementRef<HTMLElement>;

  private drag: { handle: Handle; startX: number; startY: number; startBox: CropBox } | null = null;

  boxStyle() {
    return {
      left: `${this.box.x * 100}%`,
      top: `${this.box.y * 100}%`,
      width: `${this.box.width * 100}%`,
      height: `${this.box.height * 100}%`,
    };
  }

  onPointerDown(event: PointerEvent, handle: Handle) {
    event.preventDefault();
    event.stopPropagation();
    try { (event.target as HTMLElement).setPointerCapture?.(event.pointerId); } catch { /* inactive pointer */ }
    this.drag = { handle, startX: event.clientX, startY: event.clientY, startBox: { ...this.box } };
  }

  @HostListener('window:pointermove', ['$event'])
  onPointerMove(event: PointerEvent) {
    if (!this.drag) return;
    const rect = this.frame.nativeElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dx = (event.clientX - this.drag.startX) / rect.width;
    const dy = (event.clientY - this.drag.startY) / rect.height;
    const s = this.drag.startBox;
    let { x, y, width, height } = s;

    if (this.drag.handle === 'move') {
      x = clamp(s.x + dx, 0, 1 - s.width);
      y = clamp(s.y + dy, 0, 1 - s.height);
    } else {
      const h = this.drag.handle;
      if (h.includes('w')) { const nx = clamp(s.x + dx, 0, s.x + s.width - MIN); width = s.x + s.width - nx; x = nx; }
      if (h.includes('e')) { width = clamp(s.width + dx, MIN, 1 - s.x); }
      if (h.includes('n')) { const ny = clamp(s.y + dy, 0, s.y + s.height - MIN); height = s.y + s.height - ny; y = ny; }
      if (h.includes('s')) { height = clamp(s.height + dy, MIN, 1 - s.y); }
    }

    this.box = { x, y, width, height };
    this.boxChange.emit(this.box);
  }

  @HostListener('window:pointerup', ['$event'])
  onPointerUp(event: PointerEvent) {
    if (!this.drag) return;
    try { (event.target as HTMLElement).releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
    this.drag = null;
    this.commit.emit(this.box);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
