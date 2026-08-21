export const COLLAGE_WIDTH = 1080;
export const COLLAGE_HEIGHT = 1920;

export interface CollageLayer {
  id: string;
  sourceImageUrl: string;
  cutoutImageUrl: string;
  cutoutBlob: Blob;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  zIndex: number;
  /** Which part of THIS layer's own image (cutoutBlob, at `width`x`height`)
   * is visible — normalized 0-1, independent of scaleX/scaleY/rotation.
   * {0,0,1,1} = whole image (the default, no visual change). Re-cropping
   * later only changes these four numbers; it never touches cutoutBlob. */
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export const DEFAULT_LAYER_CROP = { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 } as const;

export type CollageLayerTransform = Pick<
  CollageLayer,
  'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation'
>;

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

export type StoredCollageLayer = Omit<CollageLayer, 'cutoutImageUrl'>;

export interface CollageDraft {
  id: 'latest';
  updatedAt: number;
  width: number;
  height: number;
  layers: StoredCollageLayer[];
}
