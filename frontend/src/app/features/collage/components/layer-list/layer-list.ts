import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { CollageStoreService } from '../../services/collage-store.service';

@Component({
  selector: 'app-collage-layer-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './layer-list.html',
  styleUrl: './layer-list.css',
})
export class LayerListComponent {
  readonly store = inject(CollageStoreService);
  readonly isOpen = signal(true);
  readonly draggingId = signal<string | null>(null);
  readonly dropTargetId = signal<string | null>(null);
  readonly dragX = signal(0);
  readonly dragY = signal(0);
  readonly dragPreviewWidth = signal(0);
  readonly draggingLayer = computed(
    () => this.store.layers().find((layer) => layer.id === this.draggingId()) ?? null,
  );
  readonly dragPreviewTransform = computed(
    () => `translate3d(${this.dragX() - 28}px, ${this.dragY() - 40}px, 0)`,
  );

  private pointerId: number | null = null;
  private pendingDragId: string | null = null;
  private startX = 0;
  private startY = 0;

  get orderedLayers() {
    return [...this.store.layers()].sort((a, b) => b.zIndex - a.zIndex);
  }

  toggle(): void {
    this.isOpen.update((open) => !open);
  }

  beginPointerDrag(event: PointerEvent, id: string): void {
    if (event.button !== 0 || this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.pendingDragId = id;
    this.startX = event.clientX;
    this.startY = event.clientY;
    const row = event.currentTarget as HTMLElement;
    this.dragPreviewWidth.set(row.getBoundingClientRect().width);
    row.setPointerCapture(event.pointerId);
  }

  continuePointerDrag(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || !this.pendingDragId) return;
    const distance = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
    if (!this.draggingId() && distance < 5) return;

    event.preventDefault();
    this.dragX.set(event.clientX);
    this.dragY.set(event.clientY);
    if (!this.draggingId()) {
      this.draggingId.set(this.pendingDragId);
      this.store.select(this.pendingDragId);
    }

    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-layer-id]');
    const targetId = row?.dataset['layerId'] ?? null;
    this.dropTargetId.set(targetId && targetId !== this.draggingId() ? targetId : null);
  }

  finishPointerDrag(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    const draggedId = this.draggingId();
    const targetId = this.dropTargetId();
    if (draggedId && targetId) this.moveLayer(draggedId, targetId);
    this.resetPointerDrag(event);
  }

  cancelPointerDrag(event: PointerEvent): void {
    if (event.pointerId === this.pointerId) this.resetPointerDrag(event);
  }

  /** Keyboard/touch equivalent of dragging a row one slot up (-1, toward
   * index 0 = further forward) or down (+1 = further back) — reuses the
   * same reorderFromFront primitive the pointer-drag path already calls. */
  /** Đổi thứ tự bằng bàn phím: Alt/Ctrl + mũi tên lên/xuống trên hàng đang
   * focus. Kéo-thả không dùng được bằng bàn phím, và hàng nút lên/xuống trước
   * đây là con đường duy nhất — gỡ nó mà không có cái này là mất hẳn khả năng
   * đổi thứ tự cho người dùng bàn phím / trình đọc màn hình. */
  onRowKeydown(event: KeyboardEvent, id: string): void {
    if (!event.altKey && !event.ctrlKey && !event.metaKey) return;
    const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    this.moveStep(id, direction);
  }

  moveStep(id: string, direction: -1 | 1): void {
    const orderedIds = this.orderedLayers.map((layer) => layer.id);
    const index = orderedIds.indexOf(id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= orderedIds.length) return;
    [orderedIds[index], orderedIds[targetIndex]] = [orderedIds[targetIndex], orderedIds[index]];
    this.store.reorderFromFront(orderedIds);
  }

  private moveLayer(draggedId: string, targetId: string): void {
    const orderedIds = this.orderedLayers.map((layer) => layer.id);
    const fromIndex = orderedIds.indexOf(draggedId);
    const toIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [movedId] = orderedIds.splice(fromIndex, 1);
    if (!movedId) return;
    orderedIds.splice(toIndex, 0, movedId);
    this.store.reorderFromFront(orderedIds);
  }

  private resetPointerDrag(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    this.pointerId = null;
    this.pendingDragId = null;
    this.draggingId.set(null);
    this.dropTargetId.set(null);
    this.dragPreviewWidth.set(0);
  }

  layerNumber(id: string): number {
    const layers = this.orderedLayers;
    return layers.length - layers.findIndex((layer) => layer.id === id);
  }
}
