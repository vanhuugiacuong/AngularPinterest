import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import {
  CollageBrushKind,
  CollageTextLayer,
  isTextLayer,
} from '../../collage.types';
import { CollageStoreService } from '../../services/collage-store.service';
import { DrawingSettings } from '../collage-canvas/collage-canvas';

export type ToolPanelMode = 'draw' | 'text';

/** The right-hand column's third face, after the image picker and the cutout
 * step: settings for whichever insert tool is active. Draw settings live in the
 * parent (they apply to the next stroke, not to a layer); text settings are
 * read and written straight through to the selected text layer. */
@Component({
  selector: 'app-collage-tool-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tool-panel.html',
  styleUrl: './tool-panel.css',
})
export class ToolPanelComponent {
  @Input({ required: true }) mode!: ToolPanelMode;
  /** Draw settings are owned by the parent because they describe the brush, not
   * any existing layer — a stroke does not exist yet when they are chosen. */
  @Input({ required: true }) brush!: () => DrawingSettings;
  @Output() readonly brushChange = new EventEmitter<Partial<DrawingSettings>>();
  @Output() readonly closed = new EventEmitter<void>();

  private readonly store = inject(CollageStoreService);

  readonly textLayer = computed<CollageTextLayer | null>(() => {
    const selected = this.store.selectedLayer();
    return selected && isTextLayer(selected) ? selected : null;
  });

  readonly brushOptions: { kind: CollageBrushKind; label: string; icon: string }[] = [
    { kind: 'pen', label: 'Bút mực', icon: 'edit' },
    { kind: 'marker', label: 'Bút dạ quang', icon: 'brush' },
  ];

  readonly alignOptions: {
    value: CollageTextLayer['textAlign'];
    label: string;
    icon: string;
  }[] = [
    { value: 'left', label: 'Căn trái', icon: 'format_align_left' },
    { value: 'center', label: 'Căn giữa', icon: 'format_align_center' },
    { value: 'right', label: 'Căn phải', icon: 'format_align_right' },
  ];

  readonly fontSizes = [24, 32, 40, 48, 64, 80, 96, 120, 160];

  patchBrush(patch: Partial<DrawingSettings>): void {
    this.brushChange.emit(patch);
  }

  /** `coalesce` for the continuous controls (typing, colour dragging) so one
   * edit is one history entry instead of one per input event. */
  patchText(patch: Partial<Omit<CollageTextLayer, 'id' | 'kind'>>, coalesce = false): void {
    const layer = this.textLayer();
    if (!layer) return;
    this.store.updateText(layer.id, patch, coalesce);
  }

  /** Weight and slant are one dropdown in the UI (Pinterest's "Cỡ"), so the
   * value carries both and is split back apart here. */
  applyStylePreset(value: string): void {
    const [weight, style] = value.split('|');
    this.patchText({
      fontWeight: Number(weight) as CollageTextLayer['fontWeight'],
      fontStyle: style as CollageTextLayer['fontStyle'],
    });
  }
}
