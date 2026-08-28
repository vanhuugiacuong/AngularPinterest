import { Injectable } from '@angular/core';
import {
  COLLAGE_HEIGHT,
  COLLAGE_WIDTH,
  CollageDraft,
  CollageImageLayer,
  CollageLayer,
  DEFAULT_LAYER_CROP,
  StoredCollageLayer,
  isImageLayer,
} from '../collage.types';
import { remapCropAfterTrim, trimTransparentImage } from '../utils/trim-transparent-image';

const DATABASE_NAME = 'novaframe-collage';
const STORE_NAME = 'drafts';
const DATABASE_VERSION = 1;

@Injectable({ providedIn: 'root' })
export class CollageDraftService {
  async save(layers: CollageLayer[]): Promise<void> {
    const draft: CollageDraft = {
      id: 'latest',
      updatedAt: Date.now(),
      width: COLLAGE_WIDTH,
      height: COLLAGE_HEIGHT,
      // Object URLs are per-session, so the image variant drops its one before
      // storage; the blob it was created from is what actually persists. Text
      // and drawing layers are plain data and go through untouched.
      layers: layers.map((layer) =>
        isImageLayer(layer)
          ? (({ cutoutImageUrl: _url, ...rest }) => ({ ...rest }))(layer)
          : { ...layer },
      ),
    };
    const database = await this.openDatabase();
    await this.runRequest(database, 'readwrite', (store) => store.put(draft));
    database.close();
  }

  async load(): Promise<CollageLayer[] | null> {
    const database = await this.openDatabase();
    const draft = await this.runRequest<CollageDraft | undefined>(database, 'readonly', (store) =>
      store.get('latest'),
    );
    database.close();
    if (!draft?.layers.length) return null;
    const restored: CollageLayer[] = [];
    // Process image blobs one at a time: several 2560px cutouts decoded in
    // parallel can create a large, unnecessary memory spike during restore.
    for (const layer of draft.layers) {
      // Drafts written before layer kinds existed have no `kind` at all, and
      // every one of them was an image — so treat a missing discriminant as
      // 'image' rather than dropping the user's saved work.
      if (layer.kind === 'text' || layer.kind === 'drawing') {
        restored.push({ ...layer });
        continue;
      }
      const image = layer as Omit<CollageImageLayer, 'cutoutImageUrl'>;
      const trimmed = await trimTransparentImage(image.cutoutBlob).catch(() => null);
      if (trimmed?.changed) {
        const angle = (image.rotation * Math.PI) / 180;
        const localX = (trimmed.x + trimmed.width / 2 - trimmed.originalWidth / 2) * image.scaleX;
        const localY = (trimmed.y + trimmed.height / 2 - trimmed.originalHeight / 2) * image.scaleY;
        const mappedCrop = remapCropAfterTrim(
          {
            cropX: image.cropX ?? 0,
            cropY: image.cropY ?? 0,
            cropWidth: image.cropWidth ?? 1,
            cropHeight: image.cropHeight ?? 1,
          },
          trimmed.originalWidth,
          trimmed.originalHeight,
          trimmed,
        );
        restored.push({
          ...image,
          kind: 'image',
          cutoutBlob: trimmed.blob,
          cutoutImageUrl: URL.createObjectURL(trimmed.blob),
          width: trimmed.width,
          height: trimmed.height,
          x: image.x + localX * Math.cos(angle) - localY * Math.sin(angle),
          y: image.y + localX * Math.sin(angle) + localY * Math.cos(angle),
          ...mappedCrop,
        });
        continue;
      }
      restored.push({
        ...DEFAULT_LAYER_CROP,
        ...image,
        kind: 'image',
        cutoutImageUrl: URL.createObjectURL(image.cutoutBlob),
      });
    }
    return restored;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Không thể mở bản nháp.'));
    });
  }

  private runRequest<T = IDBValidKey>(
    database: IDBDatabase,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
        if (mode === 'readonly') resolve(result);
      };
      request.onerror = () => reject(request.error ?? new Error('Không thể xử lý bản nháp.'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Không thể xử lý bản nháp.'));
      transaction.oncomplete = () => {
        if (mode !== 'readonly') resolve(result);
      };
    });
  }
}
