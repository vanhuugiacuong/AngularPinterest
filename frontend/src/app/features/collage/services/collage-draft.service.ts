import { Injectable } from '@angular/core';
import {
  COLLAGE_HEIGHT,
  COLLAGE_WIDTH,
  CollageDraft,
  CollageLayer,
  DEFAULT_LAYER_CROP,
  StoredCollageLayer,
} from '../collage.types';

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
      layers: layers.map(({ cutoutImageUrl: _url, ...layer }) => ({ ...layer })),
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
    return draft.layers.map((layer: StoredCollageLayer) => ({
      ...DEFAULT_LAYER_CROP,
      ...layer,
      cutoutImageUrl: URL.createObjectURL(layer.cutoutBlob),
    }));
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
