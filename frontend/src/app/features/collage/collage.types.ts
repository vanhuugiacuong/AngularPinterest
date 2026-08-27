export const COLLAGE_WIDTH = 1080;
export const COLLAGE_HEIGHT = 1920;

export type CollageLayerKind = 'image' | 'text' | 'drawing';

/** Everything the canvas needs to place and stack a layer, whatever it holds.
 * Position/size/rotation/z-order are deliberately kind-agnostic so the store,
 * the layer list and the history stack never branch on kind. */
export interface CollageLayerBase {
  id: string;
  kind: CollageLayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  zIndex: number;
}

export interface CollageImageLayer extends CollageLayerBase {
  kind: 'image';
  sourceImageUrl: string;
  cutoutImageUrl: string;
  cutoutBlob: Blob;
  /** Which part of THIS layer's own image (cutoutBlob, at `width`x`height`)
   * is visible — normalized 0-1, independent of scaleX/scaleY/rotation.
   * {0,0,1,1} = whole image (the default, no visual change). Re-cropping
   * later only changes these four numbers; it never touches cutoutBlob. */
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

/** `width` on the base is the wrap width, and it is the whole point: the canvas
 * renders this as a Fabric Textbox, which reflows the text to that width and
 * grows downward. Long text therefore stays inside the layer's frame instead of
 * running off the artboard. */
export interface CollageTextLayer extends CollageLayerBase {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 700 | 800;
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  color: string;
  /** Draws a filled band behind the glyphs (Pinterest's "Đánh dấu"). */
  highlight: boolean;
  highlightColor: string;
}

/** One completed brush stroke, kept as SVG path data so it stays vector-crisp
 * at any scale and survives a draft round-trip as plain text. */
export interface CollageDrawingLayer extends CollageLayerBase {
  kind: 'drawing';
  pathData: string;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  brush: CollageBrushKind;
}

export type CollageBrushKind = 'pen' | 'marker' | 'spray' | 'calligraphy';

export type CollageLayer = CollageImageLayer | CollageTextLayer | CollageDrawingLayer;

export const DEFAULT_LAYER_CROP = { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 } as const;

export type CollageLayerTransform = Pick<
  CollageLayerBase,
  'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation'
>;

/** Narrowing helpers — cheaper to read at call sites than repeating the
 * discriminant check, and they keep the `kind` string in one place. */
export const isImageLayer = (layer: CollageLayer): layer is CollageImageLayer =>
  layer.kind === 'image';
export const isTextLayer = (layer: CollageLayer): layer is CollageTextLayer =>
  layer.kind === 'text';
export const isDrawingLayer = (layer: CollageLayer): layer is CollageDrawingLayer =>
  layer.kind === 'drawing';

export const DEFAULT_TEXT_STYLE = {
  fontFamily: 'Inter',
  fontSize: 64,
  fontWeight: 800,
  fontStyle: 'normal',
  textAlign: 'center',
  color: '#111111',
  highlight: false,
  highlightColor: '#ffffff',
} satisfies Omit<CollageTextLayer, keyof CollageLayerBase | 'kind' | 'text'>;

export const DEFAULT_BRUSH = {
  stroke: '#111111',
  strokeWidth: 14,
  strokeOpacity: 1,
  brush: 'pen',
} satisfies Omit<CollageDrawingLayer, keyof CollageLayerBase | 'kind' | 'pathData'>;

export interface CollageImageSource {
  sourceImageUrl: string;
  blob: Blob;
  title: string;
  temporaryUrl?: string;
}

export interface SegmentationResult {
  blob: Blob;
  width: number;
  height: number;
  isWholeImage?: boolean;
}

/** Draft shape. Only the image variant carries a revocable object URL, so only
 * that one loses a field on the way to storage; the blob itself is structured-
 * cloneable and persists. Text and drawing layers are plain data already. */
export type StoredCollageLayer =
  | Omit<CollageImageLayer, 'cutoutImageUrl'>
  | CollageTextLayer
  | CollageDrawingLayer;

export interface CollageDraft {
  id: 'latest';
  updatedAt: number;
  width: number;
  height: number;
  layers: StoredCollageLayer[];
}
