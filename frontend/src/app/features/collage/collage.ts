import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, HostListener, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { CollageService } from '../../core/services/collage';
import { PinService, Pin } from '../../core/services/pin';
import { BoardService, Board } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { UserService } from '../../core/services/user';
import { ToastService } from '../../core/services/toast';

export const BACKGROUND_SWATCHES: string[] = [
  '#FFFFFF', '#FFD9C7', '#FBF4B8', '#D3F2C2', '#C6F1EC', '#DAD3F5', '#FAD2E6',
  '#FF6E5C', '#FFA954', '#F9E24A', '#7BDB6E', '#4DD8D0', '#9E7CF2', '#F759A6',
  '#D8342A', '#D97A26', '#A6941F', '#3E9E3B', '#1E8FA6', '#6C3FBF', '#B01F6E',
  '#7A1518', '#7A4A1A', '#4E4A14', '#1F5C33', '#134B66', '#3A2266', '#5C1440',
];

// Matches the named font styles in Pinterest's own collage text tool. Each is pinned to
// one real weight/style loaded in index.html, and was screenshot-verified to render Vietnamese
// diacritics correctly (a few visually similar Google Fonts, e.g. Permanent Marker, silently
// fall back to a mismatched glyph for tone-marked letters and were rejected for that reason).
export const TEXT_FONT_OPTIONS: { label: string; value: string; weight: number; style: 'normal' | 'italic' }[] = [
  { label: 'Mặc định', value: 'sans-serif', weight: 700, style: 'normal' },
  { label: 'Slant', value: "'Archivo', sans-serif", weight: 900, style: 'italic' },
  { label: 'Broad', value: "'Anton', sans-serif", weight: 400, style: 'normal' },
  { label: 'Edgy', value: "'Be Vietnam Pro', sans-serif", weight: 300, style: 'normal' },
  { label: 'Poppy', value: "'Fredoka', sans-serif", weight: 600, style: 'normal' },
  { label: 'Publish', value: "'Playfair Display', serif", weight: 900, style: 'normal' },
  { label: 'Bookish', value: "'Playfair Display', serif", weight: 400, style: 'normal' },
  { label: 'Slab', value: "'Alfa Slab One', serif", weight: 400, style: 'normal' },
  { label: 'Writer', value: "'IBM Plex Mono', monospace", weight: 600, style: 'normal' },
  { label: 'Martian', value: "'Roboto Mono', monospace", weight: 600, style: 'normal' },
  { label: 'Groove', value: "'Josefin Sans', sans-serif", weight: 700, style: 'italic' },
  { label: 'Lucky', value: "'Passion One', sans-serif", weight: 700, style: 'normal' },
  { label: 'Tower', value: "'Oswald', sans-serif", weight: 700, style: 'normal' },
  { label: 'Extend', value: "'Big Shoulders', sans-serif", weight: 800, style: 'normal' },
  { label: 'Pixel', value: "'Press Start 2P', monospace", weight: 400, style: 'normal' },
  { label: 'Lemon', value: "'Lemon', sans-serif", weight: 400, style: 'normal' },
  { label: 'Cursive', value: "'Dancing Script', cursive", weight: 700, style: 'normal' },
  { label: 'Marker', value: "'Caveat', cursive", weight: 700, style: 'normal' },
  { label: 'Smiley', value: "'Patrick Hand', cursive", weight: 400, style: 'normal' },
  { label: 'Rocker', value: "'Saira Stencil One', sans-serif", weight: 400, style: 'normal' },
];

export const TEXT_FONT_SIZE_OPTIONS: number[] = [16, 20, 24, 28, 32, 40, 48, 60, 72];

// One freehand stroke, keeping the color/width/opacity it was drawn with — a 'draw'
// layer can bundle several of these (drawn in one draw-mode session) while each still
// looks the way it did when you drew it, instead of the whole layer sharing one style.
export type BrushStyle = 'pencil' | 'marker' | 'sparkle' | 'spray';

export interface DrawStroke {
  path: string; // SVG path 'd', in local coords (0,0 = the layer's own top-left)
  color: string;
  width: number;
  opacity: number;
  style?: BrushStyle; // missing on strokes drawn before this existed — treated as 'pencil'
}

export interface CollageLayer {
  id: number;
  type: 'image' | 'text' | 'draw';
  x: number; // center x, in stage px
  y: number; // center y, in stage px
  width: number;
  height: number;
  rotation: number; // degrees
  zIndex: number;
  src?: string;
  text?: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  highlight?: boolean;
  highlightColor?: string;
  strokes?: DrawStroke[]; // for 'draw' layers
}

export interface CollageDraft {
  id: string;
  title: string;
  description: string;
  boardId: string | null;
  backgroundColor: string | null;
  layers: CollageLayer[];
  updatedAt: number;
  thumbnail?: string; // composited preview (all layer types) — absent on drafts saved before this existed
}

type DragMode = 'move' | 'resize' | 'rotate';

interface DragState {
  mode: DragMode;
  layer: CollageLayer;
  startPointerX: number;
  startPointerY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startRotation: number;
  startFontSize: number;
  resizeSignX: number;
  resizeSignY: number;
}

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

@Component({
  selector: 'app-collage',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar],
  templateUrl: './collage.html',
  styleUrl: './collage.css',
})
export class Collage implements OnInit, AfterViewInit {
  private router = inject(Router);
  private collageService = inject(CollageService);
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  private userService = inject(UserService);
  private toastService = inject(ToastService);
  public supabaseService = inject(SupabaseService);

  public readonly swatches = BACKGROUND_SWATCHES;
  public readonly fontOptions = TEXT_FONT_OPTIONS;
  public readonly fontSizeOptions = TEXT_FONT_SIZE_OPTIONS;

  readonly stageWidth = 500;
  readonly stageHeight = 625;
  private readonly exportScale = 2;

  public layers = signal<CollageLayer[]>([]);
  public selectedLayerId = signal<number | null>(null);
  public backgroundColor = signal<string | null>(null);
  public isCuttingOut = signal(false);

  // Auto-save: so work isn't lost to an accidental tab close or refresh, without
  // needing an explicit "Lưu nháp" button. Debounced (silent, no toast) rather than
  // saving on every keystroke/drag — and a best-effort beforeunload save on top, since
  // saveDraft's blob-to-dataURL conversion is async and can't be reliably awaited
  // during an actual unload; the debounce is what really guarantees recent work is safe.
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSaveArmed = false;
  private autoSaveEffect = effect(() => {
    this.layers();
    this.backgroundColor();
    if (!this.autoSaveArmed) {
      this.autoSaveArmed = true;
      return;
    }
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => this.saveDraft(), 1500);
  });

  @HostListener('window:beforeunload')
  onBeforeUnload() {
    if (this.layers().length > 0) {
      this.saveDraft();
    }
  }

  public showBackgroundPicker = signal(false);
  public showPublishStep = signal(false);

  // "..." menu on the top toolbar — "Xóa bản nháp" / "Bắt đầu ảnh ghép mới", the two
  // actions Pinterest's own toolbar tucks away instead of giving each its own button.
  public showMoreMenu = signal(false);
  public moreMenuTop = 0;
  public moreMenuLeft = 0;

  toggleMoreMenu(event: Event) {
    event.stopPropagation();
    const opening = !this.showMoreMenu();
    if (opening) {
      const row = (event.currentTarget as HTMLElement).closest('.more-menu-anchor') as HTMLElement;
      const rect = row.getBoundingClientRect();
      this.moreMenuTop = rect.bottom + 8;
      this.moreMenuLeft = rect.right - 160;
    }
    this.showMoreMenu.set(opening);
  }

  // Freehand drawing tool
  public isDrawMode = signal(false);
  // Live preview, in absolute stage coordinates — one entry per stroke drawn so far
  // this draw-mode session, each keeping the style it was drawn with.
  public currentDrawSegments = signal<DrawStroke[]>([]);
  private drawPoints: { x: number; y: number }[] = [];
  private isDrawing = false;
  public drawStrokeWidth = signal(4);
  public drawStrokeColor = signal('#211922');
  public drawOpacity = signal(1);
  // 'eraser' isn't a BrushStyle — it never produces a stroke, it removes strokes underneath it.
  public drawBrushStyle = signal<BrushStyle | 'eraser'>('pencil');

  setDrawBrushStyle(style: BrushStyle | 'eraser') {
    this.drawBrushStyle.set(style);
  }

  setDrawStrokeWidth(value: number) {
    this.drawStrokeWidth.set(value);
  }

  setDrawStrokeColor(value: string) {
    this.drawStrokeColor.set(value);
  }

  setDrawOpacity(value: number) {
    this.drawOpacity.set(value);
  }

  public showDrawColorPicker = signal(false);
  public drawColorPickerTop = 0;
  public drawColorPickerLeft = 0;

  toggleDrawColorPicker(event: Event) {
    event.stopPropagation();
    const opening = !this.showDrawColorPicker();
    this.showTextColorPicker.set(false);
    this.showHighlightColorPicker.set(false);
    this.showFontPicker.set(false);
    if (opening) {
      const row = (event.currentTarget as HTMLElement).closest('.draw-color-anchor') as HTMLElement;
      const rect = row.getBoundingClientRect();
      this.drawColorPickerTop = rect.bottom + 8;
      this.drawColorPickerLeft = Math.max(8, rect.right - 256);
    }
    this.showDrawColorPicker.set(opening);
  }

  public rightTab = signal<'ideas' | 'yours' | 'drafts'>('ideas');
  public ideaPins = signal<Pin[]>([]);
  public yourPins = signal<Pin[]>([]);
  public addingPinId = signal<string | null>(null);
  public ideaSearchQuery = '';

  public drafts = signal<CollageDraft[]>([]);
  private currentDraftId: string | null = null;

  public title = '';
  public description = '';
  public boards = signal<Board[]>([]);
  public selectedBoard = signal<Board | null>(null);
  public showBoardDropdown = signal(false);
  public isPublishing = signal(false);
  // UI-only for now — no backend field to persist this yet.
  public allowRemix = signal(true);

  private nextId = 1;
  private nextZIndex = 1;
  private dragState: DragState | null = null;

  private history: { layers: CollageLayer[]; background: string | null }[] = [];
  private redoStack: { layers: CollageLayer[]; background: string | null }[] = [];
  public canUndo = signal(false);
  public canRedo = signal(false);

  private snapshot() {
    return { layers: this.layers().map((l) => ({ ...l })), background: this.backgroundColor() };
  }

  private pushHistory() {
    this.history.push(this.snapshot());
    if (this.history.length > 30) this.history.shift();
    this.redoStack = [];
    this.canUndo.set(true);
    this.canRedo.set(false);
  }

  undo() {
    if (this.history.length === 0) return;
    this.redoStack.push(this.snapshot());
    const prev = this.history.pop()!;
    this.layers.set(prev.layers);
    this.backgroundColor.set(prev.background);
    this.selectedLayerId.set(null);
    this.canUndo.set(this.history.length > 0);
    this.canRedo.set(true);
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.history.push(this.snapshot());
    const next = this.redoStack.pop()!;
    this.layers.set(next.layers);
    this.backgroundColor.set(next.background);
    this.selectedLayerId.set(null);
    this.canUndo.set(true);
    this.canRedo.set(this.redoStack.length > 0);
  }

  @ViewChild('stage') private stageRef?: ElementRef<HTMLElement>;

  ngAfterViewInit() {
    this.stageEl = this.stageRef?.nativeElement ?? null;
  }

  // Loads every pin the home feed would eventually show if you scrolled all the way
  // down (same page size, same "fewer than a full page = done" stopping rule) rather
  // than just the first 20, so "Thêm ý tưởng" has the same pool as the home page.
  private async loadAllIdeaPins() {
    const pageSize = 20;
    let page = 1;
    const all: Pin[] = [];
    try {
      while (true) {
        const pins = await this.pinService.getPins(page, pageSize);
        if (!pins || pins.length === 0) break;
        all.push(...pins);
        this.ideaPins.set([...all]);
        if (pins.length < pageSize) break;
        page++;
      }
    } catch (err) {
      console.error('Error fetching idea pins:', err);
    }
  }

  async ngOnInit() {
    this.loadDrafts();
    this.loadAllIdeaPins();

    const currentUser = this.supabaseService.user();
    if (currentUser) {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        try {
          const list = await this.boardService.getBoards(token);
          this.boards.set(list);
          if (list.length > 0) {
            this.selectedBoard.set(list[0]);
          }
        } catch (error) {
          console.error('Error fetching boards in Collage page:', error);
        }
      }

      const dbUser = await this.supabaseService.ensureDbUser();
      if (dbUser?.username) {
        try {
          const profile = await this.userService.getUserProfile(dbUser.username);
          this.yourPins.set(profile.pins || []);
        } catch (error) {
          console.error('Error fetching your pins in Collage page:', error);
        }
      }
    }
  }

  get selectedLayer(): CollageLayer | null {
    return this.layers().find((l) => l.id === this.selectedLayerId()) ?? null;
  }

  get layersNewestFirst(): CollageLayer[] {
    return [...this.layers()].sort((a, b) => b.zIndex - a.zIndex);
  }

  // === Reordering layers by dragging rows in the left panel — the row's
  // position in the list IS the stacking order (top of list = top of canvas) ===

  private draggingLayerId: number | null = null;
  public dragOverLayerId = signal<number | null>(null);

  onLayerRowDragStart(id: number, event: DragEvent) {
    this.draggingLayerId = id;
    event.dataTransfer?.setData('text/plain', String(id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onLayerRowDragOver(id: number, event: DragEvent) {
    event.preventDefault();
    if (this.draggingLayerId !== null && this.draggingLayerId !== id) {
      this.dragOverLayerId.set(id);
    }
  }

  onLayerRowDragLeave(id: number) {
    if (this.dragOverLayerId() === id) {
      this.dragOverLayerId.set(null);
    }
  }

  onLayerRowDrop(targetId: number, event: DragEvent) {
    event.preventDefault();
    this.dragOverLayerId.set(null);
    const draggedId = this.draggingLayerId;
    this.draggingLayerId = null;
    if (draggedId === null || draggedId === targetId) return;

    const ordered = this.layersNewestFirst;
    const fromIndex = ordered.findIndex((l) => l.id === draggedId);
    const toIndex = ordered.findIndex((l) => l.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    this.pushHistory();
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);

    // Rewrite zIndex so the new list order (top = front) maps directly to stacking order.
    const total = ordered.length;
    ordered.forEach((layer, i) => {
      layer.zIndex = total - i;
    });
    this.nextZIndex = total + 1;
    this.layers.update((list) => [...list]);
  }

  onLayerRowDragEnd() {
    this.draggingLayerId = null;
    this.dragOverLayerId.set(null);
  }

  close() {
    this.router.navigate(['/create']);
  }

  // === Adding layers ===

  async onAddCutoutFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const token = await this.supabaseService.getSessionToken();
    if (!token) {
      this.toastService.error('Bạn cần đăng nhập để dùng tính năng này.');
      return;
    }

    this.isCuttingOut.set(true);
    try {
      const cutoutBlob = await this.collageService.cutoutObject(file, token);
      const url = URL.createObjectURL(cutoutBlob);
      await this.addImageLayer(url);
      this.toastService.success('Đã cắt vật thể ra khỏi ảnh!');
    } catch (error) {
      console.error('Error cutting out object:', error);
      this.toastService.error('Lỗi khi cắt vật thể. Thử lại nhé.');
    } finally {
      this.isCuttingOut.set(false);
    }
  }

  onAddWholeImageFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    this.addImageLayer(url);
  }

  private async addImageLayer(url: string) {
    this.pushHistory();
    const dimensions = await this.loadImageDimensions(url);
    const maxSize = 220;
    const scale = Math.min(maxSize / dimensions.width, maxSize / dimensions.height, 1);
    const width = dimensions.width * scale;
    const height = dimensions.height * scale;

    const layer: CollageLayer = {
      id: this.nextId++,
      type: 'image',
      x: this.stageWidth / 2,
      y: this.stageHeight / 2,
      width,
      height,
      rotation: 0,
      zIndex: this.nextZIndex++,
      src: url,
    };
    this.layers.update((list) => [...list, layer]);
    this.selectedLayerId.set(layer.id);
  }

  private loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 200, height: 200 });
      img.src = url;
    });
  }

  // While a text layer is being typed into, it has no fixed size (grows with the
  // content, no resize/rotate handles). Once you click away it "bakes" into a fixed
  // box sized to fit what you typed and behaves like any other layer from then on.
  public editingTextLayerId = signal<number | null>(null);

  addTextLayer() {
    this.pushHistory();
    const layer: CollageLayer = {
      id: this.nextId++,
      type: 'text',
      x: this.stageWidth / 2,
      y: this.stageHeight / 2,
      width: 200,
      height: 60,
      rotation: 0,
      zIndex: this.nextZIndex++,
      text: '',
      fontSize: 32,
      color: '#000000',
      fontFamily: 'sans-serif',
      fontWeight: 700,
      fontStyle: 'normal',
      textAlign: 'center',
      highlight: false,
      highlightColor: '#000000',
    };
    this.layers.update((list) => [...list, layer]);
    this.startEditingText(layer.id);
  }

  // cursorOffset: character index to place the caret at once editing starts. Pass null to
  // put it at the end (new layers, or entering edit some other way than clicking the text).
  startEditingText(id: number, cursorOffset: number | null = null) {
    this.editingTextLayerId.set(id);
    this.selectedLayerId.set(id);
    const layer = this.layers().find((l) => l.id === id);
    const text = layer?.text || '';

    const seedAndFocus = (el: HTMLElement) => {
      // The template suppresses its own `{{ layer.text }}` binding while this layer is
      // editing (see collage.html), so the element has no content of its own right now —
      // seed it here, imperatively, once. If both the template interpolation AND native
      // typing were writing into this div at the same time, every keystroke would land in
      // two separate text nodes and everything the user typed would appear doubled.
      el.innerText = text;
      el.focus();
      const offset = Math.max(0, Math.min(cursorOffset ?? text.length, text.length));
      const range = document.createRange();
      if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
        range.setStart(el.firstChild, offset);
      } else {
        range.selectNodeContents(el);
      }
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    // A single queueMicrotask isn't reliably enough of a wait: Angular's own change detection
    // (which is what actually flips [attr.contenteditable] to "true" on this element) can land
    // after it, and focusing a still-non-editable div fails silently — the box looks normal but
    // nothing you type goes anywhere. Poll across animation frames until the attribute is
    // really there instead of assuming one microtask is enough.
    const waitUntilEditable = (attemptsLeft: number) => {
      const el = document.querySelector<HTMLElement>(`[data-text-layer-id="${id}"]`);
      if (el && el.getAttribute('contenteditable') === 'true') {
        seedAndFocus(el);
      } else if (attemptsLeft > 0) {
        requestAnimationFrame(() => waitUntilEditable(attemptsLeft - 1));
      }
    };
    queueMicrotask(() => waitUntilEditable(15));
  }

  onLayerDoubleClick(layer: CollageLayer, event: MouseEvent) {
    if (layer.type !== 'text' || this.isDrawMode()) return;
    event.stopPropagation();
    // Re-seeding the contenteditable's content on entry (see startEditingText) means whatever
    // caret/selection the browser's own double-click just produced is about to be wiped out —
    // so figure out where in the text they actually clicked here, while the frozen (pre-edit)
    // DOM still reflects it, and restore that same character offset after the reseed.
    let clickOffset: number | null = null;
    if (typeof document.caretRangeFromPoint === 'function') {
      const caretRange = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (caretRange && caretRange.startContainer.nodeType === Node.TEXT_NODE) {
        clickOffset = caretRange.startOffset;
      }
    }
    this.startEditingText(layer.id, clickOffset);
  }

  finishEditingText(layer: CollageLayer, event: FocusEvent) {
    // Clicking any control in the formatting panel (font, size, align, color, highlight — all
    // of it lives outside this contenteditable div) blurs it just like clicking away on the
    // canvas would. If we treated that as "done editing" the panel would close the instant you
    // tried to use it, before your click on e.g. an alignment button even took effect. Only
    // really exit when focus is headed somewhere that isn't part of that panel or its popovers.
    const nextFocus = event.relatedTarget as HTMLElement | null;
    if (nextFocus?.closest('.text-format-panel')) return;

    const el = event.target as HTMLElement;
    // Native typing during editing can leave a stray extra text node behind (browsers don't
    // always type into the one Angular's own `{{ }}` binding is tracking). Collapse back down
    // to a single node now, otherwise re-enabling that binding on freeze re-renders the real
    // text into its own node alongside the leftover one and everything appears doubled.
    el.textContent = layer.text ?? '';
    const rect = el.getBoundingClientRect();
    layer.width = Math.max(30, Math.round(rect.width));
    layer.height = Math.max(20, Math.round(rect.height));
    this.editingTextLayerId.set(null);

    if (!layer.text || !layer.text.trim()) {
      this.layers.update((list) => list.filter((l) => l.id !== layer.id));
      this.selectedLayerId.set(null);
    }
  }

  // Takes the whole option (not just its family value) because two named styles can share
  // the same underlying family at different weights (e.g. 'Publish'/'Bookish' are both
  // Playfair Display) — matching on family alone would make them indistinguishable.
  selectFontOption(opt: { value: string; weight: number; style: 'normal' | 'italic' }) {
    const layer = this.selectedLayer;
    if (!layer) return;
    layer.fontFamily = opt.value;
    layer.fontWeight = opt.weight;
    layer.fontStyle = opt.style;
    this.layers.update((list) => [...list]);
    this.showFontPicker.set(false);
  }

  fontOptionLabel(layer: CollageLayer | null): string {
    if (!layer) return '';
    const weight = layer.fontWeight || 700;
    const style = layer.fontStyle || 'normal';
    const opt = TEXT_FONT_OPTIONS.find(
      (o) => o.value === layer.fontFamily && o.weight === weight && o.style === style,
    );
    return opt?.label ?? 'Mặc định';
  }

  public showFontPicker = signal(false);
  public fontPickerTop = 0;
  public fontPickerLeft = 0;

  toggleFontPicker(event: Event) {
    event.stopPropagation();
    const opening = !this.showFontPicker();
    this.showTextColorPicker.set(false);
    this.showHighlightColorPicker.set(false);
    if (opening) {
      const row = (event.currentTarget as HTMLElement).closest('.font-picker-anchor') as HTMLElement;
      const rect = row.getBoundingClientRect();
      this.fontPickerTop = rect.bottom + 8;
      this.fontPickerLeft = rect.left;
    }
    this.showFontPicker.set(opening);
  }

  setTextFontSize(value: number) {
    const layer = this.selectedLayer;
    if (!layer) return;
    layer.fontSize = value;
    this.layers.update((list) => [...list]);
  }

  setTextAlign(value: 'left' | 'center' | 'right') {
    const layer = this.selectedLayer;
    if (!layer) return;
    layer.textAlign = value;
    this.layers.update((list) => [...list]);
  }

  setTextColor(value: string) {
    const layer = this.selectedLayer;
    if (!layer) return;
    layer.color = value;
    this.layers.update((list) => [...list]);
  }

  setTextHighlight(value: boolean) {
    const layer = this.selectedLayer;
    if (!layer) return;
    layer.highlight = value;
    this.layers.update((list) => [...list]);
  }

  setTextHighlightColor(value: string) {
    const layer = this.selectedLayer;
    if (!layer) return;
    layer.highlightColor = value;
    this.layers.update((list) => [...list]);
  }

  public showTextColorPicker = signal(false);
  public textColorPickerTop = 0;
  public textColorPickerLeft = 0;

  toggleTextColorPicker(event: Event) {
    event.stopPropagation();
    const opening = !this.showTextColorPicker();
    this.showHighlightColorPicker.set(false);
    this.showFontPicker.set(false);
    if (opening) {
      const row = (event.currentTarget as HTMLElement).closest('.text-color-anchor') as HTMLElement;
      const rect = row.getBoundingClientRect();
      this.textColorPickerTop = rect.bottom + 8;
      this.textColorPickerLeft = Math.max(8, rect.right - 256);
    }
    this.showTextColorPicker.set(opening);
  }

  public showHighlightColorPicker = signal(false);
  public highlightColorPickerTop = 0;
  public highlightColorPickerLeft = 0;

  toggleHighlightColorPicker(event: Event) {
    event.stopPropagation();
    const opening = !this.showHighlightColorPicker();
    this.showTextColorPicker.set(false);
    this.showFontPicker.set(false);
    if (opening) {
      const row = (event.currentTarget as HTMLElement).closest('.highlight-color-anchor') as HTMLElement;
      const rect = row.getBoundingClientRect();
      this.highlightColorPickerTop = rect.bottom + 8;
      this.highlightColorPickerLeft = Math.max(8, rect.right - 256);
    }
    this.showHighlightColorPicker.set(opening);
  }

  // === Right panel: browse existing pins to add ===

  setRightTab(tab: 'ideas' | 'yours' | 'drafts') {
    this.rightTab.set(tab);
  }

  get visiblePins(): Pin[] {
    const source = this.rightTab() === 'ideas' ? this.ideaPins() : this.yourPins();
    const needle = this.ideaSearchQuery.trim().toLowerCase();
    if (!needle) return source;
    return source.filter(
      (p) => p.title?.toLowerCase().includes(needle) || p.user?.username?.toLowerCase().includes(needle),
    );
  }

  // CSS `columns-3` looks right at a glance but has a real bug in a scrollable flex
  // container: instead of scrolling 3 columns vertically, it keeps adding *more* columns
  // sideways to avoid ever overflowing its height, pushing later pins off past the right
  // edge. Splitting into 3 plain flex columns ourselves sidesteps that entirely.
  get pinColumns(): Pin[][] {
    const columns: Pin[][] = [[], [], []];
    this.visiblePins.forEach((pin, i) => columns[i % 3].push(pin));
    return columns;
  }

  // Clicking a pin thumbnail opens a full "closeup" preview first (matching
  // Pinterest's real flow) instead of immediately cutting it out.
  public closeupPin = signal<Pin | null>(null);

  openCloseup(pin: Pin, event: Event) {
    event.stopPropagation();
    this.closeupPin.set(pin);
  }

  // No real topic/category data exists on a Pin — "related" is approximated as other
  // pins from the same browse pool, same as Pinterest falls back to when it has nothing
  // more specific to go on.
  get relatedPins(): Pin[] {
    const pin = this.closeupPin();
    if (!pin) return [];
    return this.ideaPins().filter((p) => p.id !== pin.id);
  }

  closeCloseup() {
    this.closeupPin.set(null);
  }

  async addPinAsCutout(pin: Pin) {
    const token = await this.supabaseService.getSessionToken();
    if (!token) {
      this.toastService.error('Bạn cần đăng nhập để dùng tính năng này.');
      return;
    }
    this.addingPinId.set(pin.id);
    try {
      const imgResponse = await fetch(pin.imageUrl);
      const imgBlob = await imgResponse.blob();
      const file = new File([imgBlob], 'pin.jpg', { type: imgBlob.type || 'image/jpeg' });
      const cutoutBlob = await this.collageService.cutoutObject(file, token);
      const url = URL.createObjectURL(cutoutBlob);
      await this.addImageLayer(url);
      this.closeCloseup();
    } catch (error) {
      console.error('Error cutting out pin from right panel:', error);
      this.toastService.error('Lỗi khi cắt vật thể từ ảnh này.');
    } finally {
      this.addingPinId.set(null);
    }
  }

  addPinWhole(pin: Pin) {
    this.addImageLayer(pin.imageUrl);
    this.closeCloseup();
  }

  // === Drafts (saved in this browser so you can come back and keep editing) ===

  private draftsStorageKey(): string {
    const userId = this.supabaseService.dbUser()?.id || this.supabaseService.user()?.id || 'guest';
    return `pinhub_collage_drafts_${userId}`;
  }

  private loadDrafts() {
    try {
      const raw = localStorage.getItem(this.draftsStorageKey());
      this.drafts.set(raw ? JSON.parse(raw) : []);
    } catch (error) {
      console.error('Error loading collage drafts:', error);
      this.drafts.set([]);
    }
  }

  private persistDrafts(list: CollageDraft[]) {
    this.drafts.set(list);
    localStorage.setItem(this.draftsStorageKey(), JSON.stringify(list));
  }

  // Blob/object URLs die once the page reloads, so drafts need real, portable
  // image data — convert every image layer's src to a base64 data URL first.
  private async toPortableLayers(): Promise<CollageLayer[]> {
    const layers = this.layers();
    return Promise.all(
      layers.map(async (layer) => {
        if (layer.type === 'image' && layer.src && layer.src.startsWith('blob:')) {
          const dataUrl = await this.blobUrlToDataUrl(layer.src);
          return { ...layer, src: dataUrl };
        }
        return { ...layer };
      }),
    );
  }

  private blobUrlToDataUrl(blobUrl: string): Promise<string> {
    return fetch(blobUrl)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
      );
  }

  // There's no explicit "save" button anymore — this only ever runs silently, via
  // auto-save, beforeunload, or as a step inside the "..." menu actions below (which
  // give their own user-facing feedback once they're done with it).
  async saveDraft() {
    if (this.layers().length === 0) {
      return;
    }
    try {
      const portableLayers = await this.toPortableLayers();
      const thumbnail = await this.renderThumbnailDataUrl(portableLayers, this.backgroundColor());
      const draft: CollageDraft = {
        id: this.currentDraftId || `draft_${Date.now()}`,
        title: this.title,
        description: this.description,
        boardId: this.selectedBoard()?.id ?? null,
        backgroundColor: this.backgroundColor(),
        layers: portableLayers,
        updatedAt: Date.now(),
        thumbnail,
      };
      this.currentDraftId = draft.id;

      const rest = this.drafts().filter((d) => d.id !== draft.id);
      this.persistDrafts([draft, ...rest]);
    } catch (error) {
      console.error('Error saving collage draft:', error);
    }
  }

  openDraft(draft: CollageDraft, event?: Event) {
    event?.stopPropagation();
    this.pushHistory();
    this.currentDraftId = draft.id;
    this.layers.set(draft.layers.map((l) => ({ ...l })));
    this.backgroundColor.set(draft.backgroundColor);
    this.title = draft.title;
    this.description = draft.description;
    const board = this.boards().find((b) => b.id === draft.boardId);
    if (board) this.selectedBoard.set(board);
    this.selectedLayerId.set(null);
    this.nextId = Math.max(0, ...draft.layers.map((l) => l.id)) + 1;
    this.nextZIndex = Math.max(0, ...draft.layers.map((l) => l.zIndex)) + 1;
  }

  deleteDraft(id: string, event: Event) {
    event.stopPropagation();
    this.openDraftMenuId.set(null);
    this.persistDrafts(this.drafts().filter((d) => d.id !== id));
    if (this.currentDraftId === id) {
      this.currentDraftId = null;
    }
  }

  draftThumbnail(draft: CollageDraft): string | null {
    if (draft.thumbnail) return draft.thumbnail;
    // Drafts saved before thumbnails existed: best-effort fallback so they aren't
    // completely blank — shows nothing for text/draw-only drafts until re-saved.
    const imageLayer = draft.layers.find((l) => l.type === 'image');
    return imageLayer?.src ?? null;
  }

  formatDraftDate(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getDate()} thg ${d.getMonth() + 1}`;
  }

  // Per-draft "..." menu (in the "Bản nháp" list) — same two actions as the top
  // toolbar's menu, just also reachable while browsing drafts instead of only while
  // actively editing.
  public openDraftMenuId = signal<string | null>(null);
  public draftMenuTop = 0;
  public draftMenuLeft = 0;

  toggleDraftMenu(id: string, event: Event) {
    event.stopPropagation();
    const opening = this.openDraftMenuId() !== id;
    if (opening) {
      const btn = event.currentTarget as HTMLElement;
      const rect = btn.getBoundingClientRect();
      this.draftMenuTop = rect.bottom + 4;
      this.draftMenuLeft = Math.max(8, rect.right - 176);
    }
    this.openDraftMenuId.set(opening ? id : null);
  }

  // Wipes the canvas back to a brand-new, untitled collage. Used by both "..." menu
  // actions below, after they've each dealt with the in-progress work their own way.
  private resetCanvasToBlank() {
    this.layers.set([]);
    this.backgroundColor.set(null);
    this.title = '';
    this.description = '';
    this.selectedLayerId.set(null);
    this.editingTextLayerId.set(null);
    this.currentDraftId = null;
    this.history = [];
    this.redoStack = [];
    this.canUndo.set(false);
    this.canRedo.set(false);
    this.nextId = 1;
    this.nextZIndex = 1;
  }

  // "Xóa bản nháp": throws away the draft you're currently editing (if it was ever
  // saved) and starts fresh — nothing gets preserved.
  deleteCurrentDraftAndStartNew() {
    this.showMoreMenu.set(false);
    if (this.currentDraftId) {
      this.persistDrafts(this.drafts().filter((d) => d.id !== this.currentDraftId));
    }
    this.resetCanvasToBlank();
    this.toastService.success('Đã xóa bản nháp và bắt đầu ảnh ghép mới.');
  }

  // "Bắt đầu ảnh ghép mới": opposite of the above — keeps the in-progress work by
  // saving it to drafts first, then starts fresh.
  async startNewCollage() {
    this.showMoreMenu.set(false);
    if (this.layers().length > 0) {
      await this.saveDraft();
    }
    this.resetCanvasToBlank();
    this.toastService.success('Đã lưu vào bản nháp và bắt đầu ảnh ghép mới.');
  }

  // === Background (the "Nền" layer in the left panel) ===

  public bgPickerTop = 0;
  public bgPickerLeft = 0;

  toggleBackgroundPicker(event?: Event) {
    event?.stopPropagation();
    this.selectedLayerId.set(null);
    const opening = !this.showBackgroundPicker();
    if (opening && event) {
      // Position as a fixed-position overlay computed from the row's real screen
      // position, rather than an absolute child — the layers panel scrolls
      // (overflow-y-auto), which clips any absolutely-positioned popover that
      // pokes out past its right edge.
      const row = (event.currentTarget as HTMLElement).closest('.bg-row-anchor') as HTMLElement;
      const rect = row.getBoundingClientRect();
      this.bgPickerTop = rect.top;
      this.bgPickerLeft = rect.right + 12;
    }
    this.showBackgroundPicker.set(opening);
  }

  setBackgroundColor(hex: string) {
    this.pushHistory();
    this.backgroundColor.set(hex);
  }

  // === Two-step flow: edit canvas, then "Tiếp theo" reveals publish details ===

  // The publish step shows a flattened, non-interactive preview (matching Pinterest's
  // own "Đăng lên bảng của bạn" screen) rather than the live editable canvas.
  public publishPreviewUrl = signal<string | null>(null);

  async goToPublishStep() {
    if (this.layers().length === 0) {
      this.toastService.error('Thêm ít nhất 1 ảnh hoặc chữ vào ảnh ghép trước đã!');
      return;
    }
    this.showPublishStep.set(true);
    this.publishPreviewUrl.set(await this.renderThumbnailDataUrl(this.layers(), this.backgroundColor(), 0.5));
  }

  backToEdit() {
    this.showPublishStep.set(false);
  }

  updateTextContent(layer: CollageLayer, event: Event) {
    const target = event.target as HTMLElement;
    layer.text = target.innerText;
  }

  // === Layer selection / ordering ===

  selectLayer(id: number, event: Event) {
    if (this.isDrawMode()) return;
    event.stopPropagation();
    this.selectedLayerId.set(id);
  }

  deselectAll() {
    this.selectedLayerId.set(null);
    this.showBackgroundPicker.set(false);
  }

  // === Freehand drawing ===
  // Every stroke drawn during one draw-mode session accumulates in pendingStrokes —
  // each keeping the color/width/opacity it was drawn with — and they only get merged
  // into a single 'draw' layer (still one style per stroke) when you exit draw mode.

  private pendingStrokes: { points: { x: number; y: number }[]; color: string; width: number; opacity: number; style: BrushStyle }[] = [];

  toggleDrawMode() {
    const wasOn = this.isDrawMode();
    if (wasOn) {
      this.commitPendingStrokes();
    }
    this.isDrawMode.set(!wasOn);
    this.selectedLayerId.set(null);
  }

  onStagePointerDown(event: PointerEvent) {
    if (this.isDrawMode()) {
      this.isDrawing = true;
      const x = event.clientX - this.stageOffsetX();
      const y = event.clientY - this.stageOffsetY();
      if (this.drawBrushStyle() === 'eraser') {
        this.drawPoints = [];
        this.eraseAt(x, y);
      } else {
        this.drawPoints = [{ x, y }];
        this.updateLivePreview();
      }
      return;
    }
    this.deselectAll();
  }

  // Erasing doesn't add ink — it removes any not-yet-committed stroke from this draw
  // session that the eraser passes over. It can't reach strokes from earlier sessions
  // (those are already their own frozen layers, same as any other layer).
  private eraseAt(x: number, y: number) {
    const radius = Math.max(10, this.drawStrokeWidth() * 2);
    const before = this.pendingStrokes.length;
    this.pendingStrokes = this.pendingStrokes.filter(
      (s) => !s.points.some((p) => Math.hypot(p.x - x, p.y - y) <= radius),
    );
    if (this.pendingStrokes.length !== before) {
      this.updateLivePreview();
    }
  }

  private strokeToPathSegment(points: { x: number; y: number }[]): string {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }

  // Parses a 'M x y L x y ...' path back into points, so particle-style brushes (sparkle,
  // spray) can scatter shapes along it without needing to store the raw points separately.
  private pathToPoints(d: string): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    const regex = /[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(d))) {
      points.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
    }
    return points;
  }

  // Deterministic (seeded by position, not Math.random) so the same stroke always scatters
  // its particles the same way — the live preview and the final canvas export must agree.
  private seededRandom(seed: number): number {
    const s = Math.sin(seed) * 43758.5453;
    return s - Math.floor(s);
  }

  particlesForStroke(seg: DrawStroke): { x: number; y: number; r: number }[] {
    if (seg.style !== 'sparkle' && seg.style !== 'spray') return [];
    const points = this.pathToPoints(seg.path);
    const spray = seg.style === 'spray';
    const spacing = spray ? 5 : Math.max(6, seg.width * 1.3);
    const jitterRadius = spray ? seg.width * 1.6 : seg.width * 0.7;
    const particlesPerStep = spray ? 3 : 1;
    const particles: { x: number; y: number; r: number }[] = [];
    let carry = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen === 0) continue;
      for (let d = carry; d < segLen; d += spacing) {
        const t = d / segLen;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        const seed = px * 12.9898 + py * 78.233 + i * 37;
        for (let k = 0; k < particlesPerStep; k++) {
          const angle = this.seededRandom(seed + k * 91.7) * Math.PI * 2;
          const dist = this.seededRandom(seed + k * 57.3) * jitterRadius;
          const rJitter = this.seededRandom(seed + k * 31.1);
          particles.push({
            x: px + Math.cos(angle) * dist,
            y: py + Math.sin(angle) * dist,
            r: (spray ? 0.5 + rJitter * 0.7 : 0.7 + rJitter * 0.5) * (seg.width / 4),
          });
        }
      }
      carry = (carry - segLen) % spacing;
      if (carry < 0) carry += spacing;
    }
    return particles;
  }

  private updateLivePreview() {
    const committed: DrawStroke[] = this.pendingStrokes.map((s) => ({
      path: this.strokeToPathSegment(s.points),
      color: s.color,
      width: s.width,
      opacity: s.opacity,
      style: s.style,
    }));
    if (this.drawPoints.length > 0) {
      committed.push({
        path: this.strokeToPathSegment(this.drawPoints),
        color: this.drawStrokeColor(),
        width: this.drawStrokeWidth(),
        opacity: this.drawOpacity(),
        style: this.drawBrushStyle() as BrushStyle,
      });
    }
    this.currentDrawSegments.set(committed);
  }

  private finishDrawingStroke() {
    this.isDrawing = false;
    if (this.drawPoints.length >= 2) {
      this.pendingStrokes.push({
        points: this.drawPoints,
        color: this.drawStrokeColor(),
        width: this.drawStrokeWidth(),
        opacity: this.drawOpacity(),
        style: this.drawBrushStyle() as BrushStyle,
      });
    }
    this.drawPoints = [];
    this.updateLivePreview();
  }

  private commitPendingStrokes() {
    if (this.pendingStrokes.length === 0) {
      this.currentDrawSegments.set([]);
      return;
    }

    const allPoints = this.pendingStrokes.flatMap((s) => s.points);
    const xs = allPoints.map((p) => p.x);
    const ys = allPoints.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(20, maxX - minX);
    const height = Math.max(20, maxY - minY);
    const strokes: DrawStroke[] = this.pendingStrokes.map((s) => ({
      path: s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - minX} ${p.y - minY}`).join(' '),
      color: s.color,
      width: s.width,
      opacity: s.opacity,
      style: s.style,
    }));

    this.pushHistory();
    const layer: CollageLayer = {
      id: this.nextId++,
      type: 'draw',
      x: minX + width / 2,
      y: minY + height / 2,
      width,
      height,
      rotation: 0,
      zIndex: this.nextZIndex++,
      strokes,
    };
    this.layers.update((list) => [...list, layer]);
    this.pendingStrokes = [];
    this.currentDrawSegments.set([]);
  }

  deleteSelected() {
    const id = this.selectedLayerId();
    if (id === null) return;
    this.pushHistory();
    this.layers.update((list) => list.filter((l) => l.id !== id));
    this.selectedLayerId.set(null);
  }

  duplicateSelected() {
    const layer = this.selectedLayer;
    if (!layer) return;
    this.pushHistory();
    const copy: CollageLayer = { ...layer, id: this.nextId++, x: layer.x + 20, y: layer.y + 20, zIndex: this.nextZIndex++ };
    this.layers.update((list) => [...list, copy]);
    this.selectedLayerId.set(copy.id);
  }

  async recutSelected() {
    const layer = this.selectedLayer;
    if (!layer || layer.type !== 'image' || !layer.src) return;

    const token = await this.supabaseService.getSessionToken();
    if (!token) {
      this.toastService.error('Bạn cần đăng nhập để dùng tính năng này.');
      return;
    }

    this.isCuttingOut.set(true);
    try {
      const imgResponse = await fetch(layer.src);
      const imgBlob = await imgResponse.blob();
      const file = new File([imgBlob], 'layer.png', { type: imgBlob.type || 'image/png' });
      const cutoutBlob = await this.collageService.cutoutObject(file, token);
      const url = URL.createObjectURL(cutoutBlob);

      this.pushHistory();
      layer.src = url;
      this.layers.update((list) => [...list]);
    } catch (error) {
      console.error('Error re-cutting layer:', error);
      this.toastService.error('Lỗi khi cắt lại vật thể.');
    } finally {
      this.isCuttingOut.set(false);
    }
  }

  // === Drag / resize / rotate ===

  startMove(layer: CollageLayer, event: PointerEvent) {
    if (this.isDrawMode()) return; // let the pointerdown bubble to the stage so drawing works over layers
    event.stopPropagation();
    event.preventDefault();
    this.pushHistory();
    this.selectedLayerId.set(layer.id);
    this.dragState = {
      mode: 'move',
      layer,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: layer.x,
      startY: layer.y,
      startWidth: layer.width,
      startHeight: layer.height,
      startRotation: layer.rotation,
      startFontSize: layer.fontSize || 32,
      resizeSignX: 1,
      resizeSignY: 1,
    };
  }

  // corner: which handle is being dragged, so growing "outward" from that corner
  // (away from center) always grows the box, regardless of which corner it is.
  startResize(layer: CollageLayer, corner: ResizeCorner, event: PointerEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.pushHistory();
    this.dragState = {
      mode: 'resize',
      layer,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: layer.x,
      startY: layer.y,
      startWidth: layer.width,
      startHeight: layer.height,
      startRotation: layer.rotation,
      startFontSize: layer.fontSize || 32,
      resizeSignX: corner === 'nw' || corner === 'sw' ? -1 : 1,
      resizeSignY: corner === 'nw' || corner === 'ne' ? -1 : 1,
    };
  }

  startRotate(layer: CollageLayer, event: PointerEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.pushHistory();
    this.dragState = {
      mode: 'rotate',
      layer,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: layer.x,
      startY: layer.y,
      startWidth: layer.width,
      startHeight: layer.height,
      startRotation: layer.rotation,
      startFontSize: layer.fontSize || 32,
      resizeSignX: 1,
      resizeSignY: 1,
    };
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent) {
    if (this.isDrawing) {
      const x = event.clientX - this.stageOffsetX();
      const y = event.clientY - this.stageOffsetY();
      if (this.drawBrushStyle() === 'eraser') {
        this.eraseAt(x, y);
      } else {
        this.drawPoints.push({ x, y });
        this.updateLivePreview();
      }
      return;
    }

    const state = this.dragState;
    if (!state) return;

    const dx = event.clientX - state.startPointerX;
    const dy = event.clientY - state.startPointerY;

    if (state.mode === 'move') {
      state.layer.x = state.startX + dx;
      state.layer.y = state.startY + dy;
    } else if (state.mode === 'resize') {
      // Rotate the screen-space delta into the layer's local (unrotated) frame
      // so resizing feels correct even when the layer has been rotated.
      const rad = (-state.startRotation * Math.PI) / 180;
      const localDx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localDy = dx * Math.sin(rad) + dy * Math.cos(rad);
      const newWidth = Math.max(30, state.startWidth + localDx * state.resizeSignX);
      const newHeight = Math.max(30, state.startHeight + localDy * state.resizeSignY);
      state.layer.width = newWidth;
      state.layer.height = newHeight;

      // Scale the font size along with the box so text layers resize the way people expect.
      if (state.layer.type === 'text') {
        const scale = (newWidth / state.startWidth + newHeight / state.startHeight) / 2;
        state.layer.fontSize = Math.max(8, Math.round(state.startFontSize * scale));
      }
    } else if (state.mode === 'rotate') {
      const centerScreenX = this.stageOffsetX() + state.startX;
      const centerScreenY = this.stageOffsetY() + state.startY;
      const angleRad = Math.atan2(event.clientY - centerScreenY, event.clientX - centerScreenX);
      state.layer.rotation = (angleRad * 180) / Math.PI + 90;
    }

    this.layers.update((list) => [...list]);
  }

  @HostListener('document:pointerup')
  onDocumentPointerUp() {
    if (this.isDrawing) {
      this.finishDrawingStroke();
    }
    this.dragState = null;
  }

  @HostListener('document:click')
  onDocumentClick() {
    // The row's own click and the popover's own click both call stopPropagation(),
    // so this only fires for genuine clicks elsewhere on the page.
    this.showBackgroundPicker.set(false);
    this.showTextColorPicker.set(false);
    this.showHighlightColorPicker.set(false);
    this.showDrawColorPicker.set(false);
    this.showFontPicker.set(false);
    this.showMoreMenu.set(false);
    this.openDraftMenuId.set(null);
  }

  private stageEl: HTMLElement | null = null;
  private stageOffsetX(): number {
    return this.stageEl?.getBoundingClientRect().left ?? 0;
  }
  private stageOffsetY(): number {
    return this.stageEl?.getBoundingClientRect().top ?? 0;
  }

  // === Board picker (matching Create page) ===

  toggleBoardDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.showBoardDropdown.update((v) => !v);
  }

  selectBoard(board: Board, event: MouseEvent) {
    event.stopPropagation();
    this.selectedBoard.set(board);
    this.showBoardDropdown.set(false);
  }

  getSelectedBoardName(): string {
    return this.selectedBoard()?.name ?? 'Chọn bảng';
  }

  // === Publish ===

  async publish() {
    if (this.layers().length === 0) {
      this.toastService.error('Thêm ít nhất 1 ảnh hoặc chữ vào ảnh ghép trước đã!');
      return;
    }
    if (!this.title.trim()) {
      this.toastService.error('Vui lòng nhập tiêu đề!');
      return;
    }
    const token = await this.supabaseService.getSessionToken();
    if (!token) return;

    this.isPublishing.set(true);
    try {
      const blob = await this.renderToBlob();
      const formData = new FormData();
      formData.append('image', blob, 'collage.png');
      formData.append('title', this.title.trim());
      formData.append('description', this.description.trim());
      const boardId = this.selectedBoard()?.id;
      if (boardId) {
        formData.append('boardId', boardId);
      }

      await this.pinService.createUploadPin(formData, token);
      this.toastService.success('Đăng ảnh ghép thành công!');
      this.router.navigate(['/feed']);
    } catch (error) {
      console.error('Error publishing collage:', error);
      this.toastService.error('Lỗi khi đăng ảnh ghép.');
    } finally {
      this.isPublishing.set(false);
    }
  }

  // Shared by the full-quality publish export and draft thumbnails — draws every layer
  // type (image/text/draw, including particle brushes) onto any canvas at any scale.
  private async drawLayersToCanvas(ctx: CanvasRenderingContext2D, layers: CollageLayer[], scale: number) {
    const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
    for (const layer of sorted) {
      ctx.save();
      ctx.translate(layer.x * scale, layer.y * scale);
      ctx.rotate((layer.rotation * Math.PI) / 180);

      if (layer.type === 'image' && layer.src) {
        const img = await this.loadImageElement(layer.src);
        ctx.drawImage(
          img,
          (-layer.width / 2) * scale,
          (-layer.height / 2) * scale,
          layer.width * scale,
          layer.height * scale,
        );
      } else if (layer.type === 'text') {
        const fontSize = (layer.fontSize || 32) * scale;
        const fontFamily = layer.fontFamily || 'sans-serif';
        const fontStyle = layer.fontStyle || 'normal';
        const fontWeight = layer.fontWeight || 700;
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.textBaseline = 'middle';

        const align = layer.textAlign || 'center';
        ctx.textAlign = align;
        const anchorX =
          align === 'left' ? (-layer.width / 2) * scale
          : align === 'right' ? (layer.width / 2) * scale
          : 0;

        const text = layer.text || '';
        if (layer.highlight) {
          const metrics = ctx.measureText(text);
          const padX = fontSize * 0.25;
          const padY = fontSize * 0.15;
          const boxLeft =
            align === 'left' ? anchorX - padX
            : align === 'right' ? anchorX - metrics.width - padX
            : anchorX - metrics.width / 2 - padX;
          ctx.fillStyle = layer.highlightColor || '#000000';
          ctx.fillRect(boxLeft, -fontSize / 2 - padY, metrics.width + padX * 2, fontSize + padY * 2);
          ctx.fillStyle = layer.color || '#000000';
        } else {
          ctx.fillStyle = layer.color || '#000000';
        }
        ctx.fillText(text, anchorX, 0);
      } else if (layer.type === 'draw' && layer.strokes) {
        ctx.translate((-layer.width / 2) * scale, (-layer.height / 2) * scale);
        ctx.scale(scale, scale);
        ctx.lineJoin = 'round';
        for (const seg of layer.strokes) {
          const style = seg.style || 'pencil';
          ctx.globalAlpha = seg.opacity;
          if (style === 'sparkle' || style === 'spray') {
            ctx.fillStyle = seg.color;
            for (const p of this.particlesForStroke(seg)) {
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            ctx.strokeStyle = seg.color;
            ctx.lineWidth = seg.width;
            ctx.lineCap = style === 'marker' ? 'square' : 'round';
            ctx.stroke(new Path2D(seg.path));
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  private renderToBlob(): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = this.stageWidth * this.exportScale;
      canvas.height = this.stageHeight * this.exportScale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }

      const bg = this.backgroundColor();
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      await this.drawLayersToCanvas(ctx, this.layers(), this.exportScale);

      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to export canvas'));
      }, 'image/png');
    });
  }

  // A small composited preview for the drafts list — same drawing logic as the real
  // export, just scaled way down so hundreds of drafts don't bloat localStorage.
  private async renderThumbnailDataUrl(layers: CollageLayer[], backgroundColor: string | null, scale = 0.3): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = this.stageWidth * scale;
    canvas.height = this.stageHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    await this.drawLayersToCanvas(ctx, layers, scale);
    // PNG, not JPEG: a draft with no background set should stay transparent in its
    // thumbnail (the draft card behind it already renders the checkerboard "no
    // background" pattern) — JPEG has no alpha channel and would flatten that to black.
    return canvas.toDataURL('image/png');
  }

  private loadImageElement(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
}
