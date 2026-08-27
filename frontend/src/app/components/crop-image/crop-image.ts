import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CropperPosition, Dimensions, ImageCropperComponent, ImageTransform, OutputFormat } from 'ngx-image-cropper';
import { CreateDraftService } from '../../core/services/create-draft';

export type AspectRatioKey = 'original' | '1:1' | '4:5' | '16:9';

export interface CroppedImage {
  originalFile: File;
  croppedBlob: Blob;
  aspectRatio: string;
}

interface NaturalSize {
  width: number;
  height: number;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const CROPPER_READY_TIMEOUT_MS = 4000;
const MAX_IMAGES = 10;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const REORDER_HINT_MS = 4500;
const LIMIT_NOTICE_MS = 3000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

@Component({
  selector: 'app-crop-image',
  imports: [CommonModule, ImageCropperComponent],
  templateUrl: './crop-image.html',
  styleUrl: './crop-image.scss'
})
export class CropImageComponent implements OnChanges, OnDestroy {
  @Input() files: File[] = [];

  @Output() next = new EventEmitter<CroppedImage[]>();
  @Output() back = new EventEmitter<void>();
  // Emitted whenever the in-tray controls change the selected list (add / remove / reorder).
  // The parent owns the File[] that feeds [files] back in, so it must mirror this.
  @Output() filesChange = new EventEmitter<File[]>();

  public readonly maxImages = MAX_IMAGES;

  // A single <image-cropper> is reused for whichever image is current. Mounting one instance
  // per file and hiding the rest doesn't work with this library — it gives up (after ~40 retries)
  // trying to measure an element that starts out hidden/zero-size, and never recovers even once
  // shown later. Per-image crop position + zoom are saved/restored by hand instead.
  @ViewChild(ImageCropperComponent) private cropperRef?: ImageCropperComponent;
  @ViewChild('trayFileInput') private trayFileInputRef?: ElementRef<HTMLInputElement>;

  public readonly aspectOptions: { key: AspectRatioKey; label: string }[] = [
    { key: 'original', label: 'Gốc' },
    { key: '1:1', label: '1:1' },
    { key: '4:5', label: '4:5' },
    { key: '16:9', label: '16:9' }
  ];

  public currentIndex = signal(0);
  public aspectKeys = signal<AspectRatioKey[]>([]);
  public transforms = signal<ImageTransform[]>([]);
  public cropperPositions = signal<(CropperPosition | undefined)[]>([]);
  // Per-image, aligned with `files` by position (arrays, not index maps) so add / remove /
  // reorder in the tray can keep them in lockstep with the file list.
  public naturalSizes = signal<(NaturalSize | undefined)[]>([]);
  // The library's own displayed-image size (at scale 1, before zoom) per image, reported via
  // (cropperReady). Needed to clamp panning — ngx-image-cropper applies [transform] translateH/V
  // completely unbounded (confirmed in its source: no clamping in the Drag move-handler), so
  // dragging far enough exposes empty space inside the crop frame unless we clamp it ourselves.
  public baseImageSizes = signal<(Dimensions | undefined)[]>([]);
  public showAspectPopup = signal(false);
  public isGeneratingCrops = signal(false);
  public pendingCropperPosition = signal<CropperPosition | undefined>(undefined);

  public currentFile = computed<File | null>(() => this.files[this.currentIndex()] ?? null);
  public currentAspect = computed<AspectRatioKey>(() => this.aspectKeys()[this.currentIndex()] ?? 'original');
  public currentAspectRatio = computed<number>(() => this.aspectRatioFor(this.currentIndex()));
  public currentFormat = computed<OutputFormat>(() => this.formatFor(this.currentIndex()));
  public currentTransform = computed<ImageTransform>(() => this.transforms()[this.currentIndex()] ?? { scale: 1 });

  // Percentage position of the zoom slider's thumb/fill, mapped from the cropper's own scale range.
  public zoomPercent = computed<number>(() => {
    const scale = this.currentTransform().scale ?? ZOOM_MIN;
    return clamp(((scale - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100, 0, 100);
  });

  public zoomTrackDragging = signal(false);

  // Zoom pill visibility — toggled only by the magnifier icon (or a click outside it).
  // No auto-hide. This is purely a show/hide layer; the zoom values and slider geometry
  // are untouched.
  public zoomBarOpen = signal(false);

  // ---- Selected-images tray (Instagram-style) ----
  // Object URLs for the thumbnails, aligned with `files`. Kept in a per-File map so a
  // reorder / remove doesn't revoke a URL an <img> is still showing (which would flash
  // a broken thumbnail).
  public previewUrls = signal<string[]>([]);
  private urlByFile = new Map<File, string>();
  // Index being dragged in the tray, -1 when not dragging.
  public dragIndex = signal(-1);
  // Speech-bubble hint above the tray ("Nhấp và kéo để sắp xếp lại"). Shows once per
  // editing session when there are >= 2 images; hides on a timer or the first drag.
  public reorderHintVisible = signal(false);
  private reorderHintDismissed = false;
  private reorderHintTimer: ReturnType<typeof setTimeout> | null = null;
  // Small "Đã đạt giới hạn 10 ảnh" line, shown briefly when the user tries to exceed the cap.
  public limitNoticeVisible = signal(false);
  private limitNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  // Set right before we emit (filesChange) so the echoed [files] input change doesn't
  // trigger a full initFromFiles() reset that would wipe the per-image crop edits.
  private suppressNextInit = false;

  private cropperReadyResolvers: (() => void)[] = [];

  private readonly draft = inject(CreateDraftService);
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private editingDone = false;
  // Crop rectangles pulled from a restored draft, per image index. Applied once when
  // that image's cropper first becomes ready and then cleared — the library wipes the
  // `[cropper]` input back to the full image during its own initial load, so the saved
  // rectangle has to be re-applied afterwards rather than just handed in up front.
  private restoredCropperPositions: (CropperPosition | undefined)[] | null = null;

  constructor() {
    // Mirror the crop scalars (current image, per-image aspect / zoom-pan / crop box)
    // into the draft store on every change, debounced, so a full page reload mid-edit
    // can restore them. Reads all four signals so the effect re-runs when any change.
    effect(() => {
      this.currentIndex();
      this.aspectKeys();
      this.transforms();
      this.cropperPositions();
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
      }
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.persistCropState();
      }, 250);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['files']) {
      // A change we caused ourselves (tray add/remove/reorder) is already reflected in
      // every per-image array — don't reset them.
      if (this.suppressNextInit) {
        this.suppressNextInit = false;
        return;
      }
      this.initFromFiles();
    }
  }

  ngOnDestroy(): void {
    // No final flush here on purpose: the debounced effect already persisted every
    // change, and flushing on teardown would race the `draft.clear()` that the parent
    // runs when the crop step finishes — re-creating a draft that was just cleared.
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.reorderHintTimer) {
      clearTimeout(this.reorderHintTimer);
      this.reorderHintTimer = null;
    }
    if (this.limitNoticeTimer) {
      clearTimeout(this.limitNoticeTimer);
      this.limitNoticeTimer = null;
    }
    this.revokeUrls();
  }

  private persistCropState(): void {
    // Once the user has left the crop step (Back / Tiếp), the parent clears the draft;
    // a late debounced write must not resurrect it.
    if (this.editingDone || this.files.length === 0) {
      return;
    }
    this.draft.saveCropState({
      step: 'crop',
      currentIndex: this.currentIndex(),
      aspectKeys: this.aspectKeys(),
      transforms: this.transforms(),
      cropperPositions: this.cropperPositions(),
      fileMeta: this.draft.metaFor(this.files)
    });
  }

  // ---- Header actions ----

  onBack(): void {
    this.editingDone = true;
    this.back.emit();
  }

  async onNext(): Promise<void> {
    if (this.isGeneratingCrops() || this.files.length === 0) return;

    this.isGeneratingCrops.set(true);
    const originalIndex = this.currentIndex();
    try {
      const results: CroppedImage[] = [];
      for (let i = 0; i < this.files.length; i++) {
        if (this.currentIndex() !== i) {
          const ready = this.waitForCropperReady();
          this.currentIndex.set(i);
          await ready;
        }
        const event = await this.cropperRef?.crop('blob');
        if (!event?.blob) {
          throw new Error('Không tạo được ảnh đã cắt.');
        }
        results.push({
          originalFile: this.files[i],
          croppedBlob: event.blob,
          aspectRatio: this.aspectKeys()[i] ?? 'original'
        });
      }
      this.editingDone = true;
      this.next.emit(results);
    } finally {
      this.currentIndex.set(originalIndex);
      this.isGeneratingCrops.set(false);
    }
  }

  // ---- <image-cropper> lifecycle ----

  onCropperReady(dimensions: Dimensions): void {
    const index = this.currentIndex();
    this.baseImageSizes.update((sizes) => sizes.map((s, i) => (i === index ? dimensions : s)));

    // A restored-from-draft rectangle wins over whatever the library just settled on
    // during load, but only the first time — consume it so later resets aren't blocked.
    const restored = this.restoredCropperPositions?.[index];
    if (this.restoredCropperPositions) {
      this.restoredCropperPositions[index] = undefined;
    }
    const saved = restored ?? this.cropperPositions()[index];
    this.pendingCropperPosition.set(saved ? { ...saved } : undefined);

    const resolvers = this.cropperReadyResolvers;
    this.cropperReadyResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  onCropperPositionChange(position: CropperPosition): void {
    const index = this.currentIndex();
    this.cropperPositions.update((list) => list.map((p, i) => (i === index ? position : p)));
  }

  onTransformChange(transform: ImageTransform): void {
    const index = this.currentIndex();
    const clamped = this.clampTransform(index, transform);
    this.transforms.update((list) => list.map((t, i) => (i === index ? clamped : t)));
  }

  // ngx-image-cropper applies translateH/translateV with no bounds of its own. Clamp them here
  // so the image can never be dragged far enough to expose empty space inside the (fixed-size,
  // centered) crop frame — panning stays bound to how much the zoomed image overhangs the frame.
  private clampTransform(index: number, transform: ImageTransform): ImageTransform {
    const base = this.baseImageSizes()[index];
    const cropperPos = this.cropperPositions()[index];
    if (!base || !cropperPos) return transform;

    const scale = transform.scale ?? 1;
    const displayedWidth = base.width * scale;
    const displayedHeight = base.height * scale;
    const cropperWidth = cropperPos.x2 - cropperPos.x1;
    const cropperHeight = cropperPos.y2 - cropperPos.y1;

    const maxTranslateX = Math.max(0, (displayedWidth - cropperWidth) / 2);
    const maxTranslateY = Math.max(0, (displayedHeight - cropperHeight) / 2);

    return {
      ...transform,
      translateH: clamp(transform.translateH ?? 0, -maxTranslateX, maxTranslateX),
      translateV: clamp(transform.translateV ?? 0, -maxTranslateY, maxTranslateY)
    };
  }

  // ---- Aspect ratio popup ----

  toggleAspectPopup(event: MouseEvent): void {
    event.stopPropagation();
    this.showAspectPopup.update((v) => !v);
  }

  selectAspect(key: AspectRatioKey): void {
    const index = this.currentIndex();
    this.aspectKeys.update((keys) => keys.map((k, i) => (i === index ? key : k)));
    // The saved position was for the old ratio's crop box — let the library auto-fit a fresh
    // one for the new ratio instead of forcing a mismatched rectangle onto it.
    this.cropperPositions.update((list) => list.map((p, i) => (i === index ? undefined : p)));
    this.showAspectPopup.set(false);
  }

  closePopups(): void {
    this.showAspectPopup.set(false);
    // A click anywhere in the stage that isn't the pill or its toggle also closes the zoom pill.
    this.zoomBarOpen.set(false);
  }

  // ---- Zoom pill toggle (magnifier icon) ----

  toggleZoomBar(event: Event): void {
    event.stopPropagation();
    this.zoomBarOpen.update((v) => !v);
  }

  // ---- Multi-image navigation ----

  goToNext(event: MouseEvent): void {
    event.stopPropagation();
    if (this.currentIndex() < this.files.length - 1) {
      this.currentIndex.update((i) => i + 1);
      this.showAspectPopup.set(false);
    }
  }

  goToPrev(event: MouseEvent): void {
    event.stopPropagation();
    if (this.currentIndex() > 0) {
      this.currentIndex.update((i) => i - 1);
      this.showAspectPopup.set(false);
    }
  }

  // ---- Selected-images tray: jump to, add, remove, reorder ----

  goToImage(index: number): void {
    // A click that ends a drag would otherwise also select — ignore it.
    if (this.dragIndex() !== -1) return;
    if (index < 0 || index >= this.files.length || index === this.currentIndex()) return;
    this.currentIndex.set(index);
    this.showAspectPopup.set(false);
  }

  openTrayFilePicker(): void {
    if (this.files.length >= MAX_IMAGES) {
      this.showLimitNotice();
      return;
    }
    this.trayFileInputRef?.nativeElement.click();
  }

  onTrayFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.addFiles(Array.from(input.files));
    }
    input.value = '';
  }

  removeImage(index: number, event: Event): void {
    event.stopPropagation();
    if (index < 0 || index >= this.files.length) return;

    const currentRef = this.currentFile();
    const drop = <T,>(list: T[]): T[] => list.filter((_, i) => i !== index);

    this.files = drop(this.files);
    this.aspectKeys.set(drop(this.aspectKeys()));
    this.transforms.set(drop(this.transforms()));
    this.cropperPositions.set(drop(this.cropperPositions()));
    this.naturalSizes.set(drop(this.naturalSizes()));
    this.baseImageSizes.set(drop(this.baseImageSizes()));

    // Removing the last image empties the list — the tray hides and only the "Mở thư viện"
    // icon is left, ready to rebuild the list.
    if (this.files.length === 0) {
      this.currentIndex.set(0);
      this.pendingCropperPosition.set(undefined);
      this.dismissReorderHint();
      this.afterListMutation();
      return;
    }

    // Keep the same image focused if it's still here; otherwise clamp into range. When the
    // focused image itself was removed, currentFile() changes and the cropper reloads, so
    // onCropperReady re-applies that image's saved crop box.
    let nextIndex = currentRef ? this.files.indexOf(currentRef) : -1;
    if (nextIndex < 0) nextIndex = clamp(index, 0, this.files.length - 1);
    this.currentIndex.set(nextIndex);

    if (this.files.length < 2) this.dismissReorderHint();
    this.afterListMutation();
  }

  onThumbDragStart(index: number, event: DragEvent): void {
    this.dragIndex.set(index);
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.dismissReorderHint();
  }

  onThumbDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  onThumbDrop(targetIndex: number, event: DragEvent): void {
    event.preventDefault();
    const from = this.dragIndex();
    this.dragIndex.set(-1);
    if (from < 0 || from === targetIndex) return;
    this.moveImage(from, targetIndex);
  }

  onThumbDragEnd(): void {
    this.dragIndex.set(-1);
  }

  private addFiles(incoming: File[]): void {
    const valid = incoming.filter((file) => ALLOWED_IMAGE_TYPES.includes(file.type));
    const room = MAX_IMAGES - this.files.length;
    const toAdd = room > 0 ? valid.slice(0, room) : [];
    if (toAdd.length < valid.length) this.showLimitNotice();
    if (toAdd.length === 0) return;

    this.files = [...this.files, ...toAdd];
    this.aspectKeys.update((a) => [...a, ...toAdd.map(() => 'original' as AspectRatioKey)]);
    this.transforms.update((t) => [
      ...t,
      ...toAdd.map(() => ({ scale: 1, translateUnit: 'px' as const }))
    ]);
    this.cropperPositions.update((c) => [...c, ...toAdd.map(() => undefined)]);
    this.naturalSizes.update((n) => [...n, ...toAdd.map(() => undefined)]);
    this.baseImageSizes.update((b) => [...b, ...toAdd.map(() => undefined)]);

    this.afterListMutation();
    this.maybeShowReorderHint();
  }

  private moveImage(from: number, to: number): void {
    const currentRef = this.currentFile();
    const move = <T,>(list: T[]): T[] => {
      const copy = list.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    };

    this.files = move(this.files);
    this.aspectKeys.set(move(this.aspectKeys()));
    this.transforms.set(move(this.transforms()));
    this.cropperPositions.set(move(this.cropperPositions()));
    this.naturalSizes.set(move(this.naturalSizes()));
    this.baseImageSizes.set(move(this.baseImageSizes()));

    // The focused image keeps its identity across a reorder — follow it to its new slot so
    // the cropper (which isn't reloading) stays lined up with the per-image arrays.
    const nextIndex = currentRef ? this.files.indexOf(currentRef) : this.currentIndex();
    this.currentIndex.set(Math.max(0, nextIndex));

    this.afterListMutation();
  }

  // Shared tail for every tray mutation: refresh thumbnails, tell the parent, persist.
  private afterListMutation(): void {
    this.showAspectPopup.set(false);
    this.syncPreviewUrls();
    this.probeNaturalSizes();
    this.suppressNextInit = true;
    this.filesChange.emit([...this.files]);
    this.persistCropState();
  }

  private maybeShowReorderHint(): void {
    if (this.reorderHintDismissed || this.files.length < 2) return;
    this.reorderHintVisible.set(true);
    if (this.reorderHintTimer) clearTimeout(this.reorderHintTimer);
    this.reorderHintTimer = setTimeout(() => {
      this.reorderHintVisible.set(false);
      this.reorderHintTimer = null;
    }, REORDER_HINT_MS);
  }

  private dismissReorderHint(): void {
    this.reorderHintDismissed = true;
    this.reorderHintVisible.set(false);
    if (this.reorderHintTimer) {
      clearTimeout(this.reorderHintTimer);
      this.reorderHintTimer = null;
    }
  }

  private showLimitNotice(): void {
    this.limitNoticeVisible.set(true);
    if (this.limitNoticeTimer) clearTimeout(this.limitNoticeTimer);
    this.limitNoticeTimer = setTimeout(() => {
      this.limitNoticeVisible.set(false);
      this.limitNoticeTimer = null;
    }, LIMIT_NOTICE_MS);
  }

  private syncPreviewUrls(): void {
    for (const file of this.files) {
      if (!this.urlByFile.has(file)) {
        this.urlByFile.set(file, URL.createObjectURL(file));
      }
    }
    for (const [file, url] of Array.from(this.urlByFile.entries())) {
      if (!this.files.includes(file)) {
        URL.revokeObjectURL(url);
        this.urlByFile.delete(file);
      }
    }
    this.previewUrls.set(this.files.map((file) => this.urlByFile.get(file) ?? ''));
  }

  private probeNaturalSizes(): void {
    const urls = this.previewUrls();
    this.files.forEach((_file, index) => {
      if (this.naturalSizes()[index]) return;
      const url = urls[index];
      if (!url) return;
      const img = new Image();
      img.addEventListener('load', () => {
        this.naturalSizes.update((sizes) =>
          sizes.map((s, i) =>
            i === index ? { width: img.naturalWidth, height: img.naturalHeight } : s
          )
        );
      });
      img.src = url;
    });
  }

  // ---- Hover tooltip, shared by the small icons around the crop frame ----
  // Positioned with `position: fixed` and coordinates measured from the icon on hover, because
  // the crop stage clips overflow and would otherwise cut a tooltip sitting just below an icon.

  public tooltipText = signal('');
  public tooltipVisible = signal(false);
  public tooltipLeft = signal(0);
  public tooltipTop = signal(0);

  showTooltip(event: MouseEvent, text: string): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.tooltipText.set(text);
    this.tooltipLeft.set(rect.left + rect.width / 2);
    this.tooltipTop.set(rect.bottom + 10);
    this.tooltipVisible.set(true);
  }

  hideTooltip(): void {
    this.tooltipVisible.set(false);
  }

  // ---- Zoom slider (Instagram-style — track + thumb only, no buttons) — drives the cropper's
  // own transform ----

  onZoomTrackPointerDown(event: PointerEvent): void {
    event.stopPropagation();
    this.zoomTrackDragging.set(true);
    this.setZoomFromPointer(event);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic or already-released pointer id throws NotFoundError here; harmless to skip.
    }
  }

  onZoomTrackPointerMove(event: PointerEvent): void {
    if (!this.zoomTrackDragging()) return;
    this.setZoomFromPointer(event);
  }

  onZoomTrackPointerUp(): void {
    this.zoomTrackDragging.set(false);
  }

  private setZoomFromPointer(event: PointerEvent): void {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const ratio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    this.setZoom(ZOOM_MIN + ratio * (ZOOM_MAX - ZOOM_MIN));
  }

  private setZoom(scale: number): void {
    const index = this.currentIndex();
    const clampedScale = clamp(scale, ZOOM_MIN, ZOOM_MAX);
    const next = this.clampTransform(index, { ...this.currentTransform(), scale: clampedScale });
    this.transforms.update((list) => list.map((t, i) => (i === index ? next : t)));
  }

  // ---- Internal helpers ----

  private aspectRatioFor(index: number): number {
    switch (this.aspectKeys()[index]) {
      case '4:5':
        return 4 / 5;
      case '16:9':
        return 16 / 9;
      case '1:1':
        return 1;
      default: {
        const size = this.naturalSizes()[index];
        return size ? size.width / size.height : 1;
      }
    }
  }

  private formatFor(index: number): OutputFormat {
    const type = this.files[index]?.type;
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    return 'jpeg';
  }

  private waitForCropperReady(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      this.cropperReadyResolvers.push(finish);
      setTimeout(finish, CROPPER_READY_TIMEOUT_MS);
    });
  }

  private initFromFiles(): void {
    this.revokeUrls();

    // If the page reloaded mid-edit, come back to the exact same crop state instead
    // of resetting. Only trust the draft when it was saved for this same set of files.
    const saved = this.draft.loadCropState();
    const restore =
      !!saved &&
      this.draft.filesMatch(this.files, saved.fileMeta) &&
      saved.aspectKeys?.length === this.files.length &&
      saved.transforms?.length === this.files.length &&
      saved.cropperPositions?.length === this.files.length
        ? saved
        : null;

    this.currentIndex.set(
      restore ? clamp(restore.currentIndex ?? 0, 0, this.files.length - 1) : 0
    );
    this.showAspectPopup.set(false);
    this.zoomBarOpen.set(false);
    this.aspectKeys.set(
      restore
        ? (restore.aspectKeys as AspectRatioKey[])
        : this.files.map(() => 'original' as AspectRatioKey)
    );
    // translateUnit: 'px' — the library defaults to '%' of the image's own size, which doesn't
    // match the raw mouse-delta pixels it adds to translateH/V internally, and doesn't match the
    // pixel-based clamp math below. Forcing 'px' keeps both consistent.
    this.transforms.set(
      restore
        ? (restore.transforms as ImageTransform[]).map((t) => ({ translateUnit: 'px', ...t }))
        : this.files.map(() => ({ scale: 1, translateUnit: 'px' }))
    );
    this.cropperPositions.set(
      restore
        ? (restore.cropperPositions as (CropperPosition | undefined)[])
        : this.files.map(() => undefined)
    );
    this.restoredCropperPositions = restore
      ? (restore.cropperPositions as (CropperPosition | undefined)[]).map((p) => (p ? { ...p } : undefined))
      : null;
    this.pendingCropperPosition.set(this.cropperPositions()[this.currentIndex()] ?? undefined);
    this.naturalSizes.set(this.files.map(() => undefined));
    this.baseImageSizes.set(this.files.map(() => undefined));

    this.syncPreviewUrls();
    this.probeNaturalSizes();

    this.dragIndex.set(-1);
    this.limitNoticeVisible.set(false);
    this.reorderHintDismissed = false;
    this.maybeShowReorderHint();
  }

  private revokeUrls(): void {
    for (const url of this.urlByFile.values()) {
      URL.revokeObjectURL(url);
    }
    this.urlByFile.clear();
    this.previewUrls.set([]);
  }
}
