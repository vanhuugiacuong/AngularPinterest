import { Injectable } from '@angular/core';

/**
 * Keeps the in-progress "Sửa ảnh" (crop) editing session alive across a full page
 * reload, so switching to another browser tab and back doesn't wipe it.
 *
 * Why this is needed: `ng serve` runs a Vite dev server whose HMR client calls
 * `location.reload()` whenever its WebSocket drops and reconnects — which is what
 * Chrome's background-tab freezing triggers. A full reload throws away every
 * component signal, so the selected image and crop position vanish. Persisting
 * here and restoring on load makes the session survive that reload (and any other
 * cause of the create page remounting).
 *
 * - The picked image File(s) go to IndexedDB (survives reload; File/Blob can't be
 *   JSON-stringified into sessionStorage and can be tens of MB).
 * - The crop scalars (step, current image, per-image aspect / zoom-pan transform /
 *   crop rectangle) go to sessionStorage — per-tab, cleared when the tab closes,
 *   which is exactly the lifetime an editing session should have.
 *
 * The sessionStorage record is the source of truth for "a draft exists". If it's
 * gone (tab was closed) any leftover IndexedDB blob is treated as stale and cleared.
 */

export interface DraftFileMeta {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export interface CropDraftState {
  step: 'crop';
  currentIndex: number;
  aspectKeys: string[];
  // Kept structurally loose on purpose — these mirror ngx-image-cropper's own
  // ImageTransform / CropperPosition shapes, round-tripped through JSON.
  transforms: unknown[];
  cropperPositions: unknown[];
  fileMeta: DraftFileMeta[];
  savedAt: number;
}

const STATE_KEY = 'pinhub_create_crop_draft';
const DB_NAME = 'pinhub_create_draft';
const DB_STORE = 'files';
const DB_KEY = 'images';
// Drop anything older than this so a long-abandoned draft doesn't silently reopen
// days later. sessionStorage already clears on tab close; this covers the "same tab
// left open for a very long time" case.
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

@Injectable({ providedIn: 'root' })
export class CreateDraftService {
  // ---- crop scalar state (sessionStorage) ----

  saveCropState(state: Omit<CropDraftState, 'savedAt'>): void {
    try {
      const payload: CropDraftState = { ...state, savedAt: Date.now() };
      sessionStorage.setItem(STATE_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage unavailable / full — the session just won't survive a reload.
    }
  }

  loadCropState(): CropDraftState | null {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CropDraftState;
      if (!parsed || parsed.step !== 'crop') return null;
      if (Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** True when `files` are the same set the draft was saved for (order included). */
  filesMatch(files: File[], meta: DraftFileMeta[] | undefined): boolean {
    if (!meta || meta.length !== files.length || files.length === 0) return false;
    return files.every(
      (f, i) => f.name === meta[i].name && f.size === meta[i].size && f.type === meta[i].type,
    );
  }

  metaFor(files: File[]): DraftFileMeta[] {
    return files.map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
      lastModified: f.lastModified,
    }));
  }

  // ---- picked image files (IndexedDB) ----

  async saveFiles(files: File[]): Promise<void> {
    try {
      const db = await this.openDb();
      await this.tx(db, 'readwrite', (store) =>
        store.put({ files, savedAt: Date.now() }, DB_KEY),
      );
      db.close();
    } catch {
      // IndexedDB unavailable (private mode, disabled) — files won't survive a reload.
    }
  }

  async loadFiles(): Promise<File[]> {
    try {
      const db = await this.openDb();
      const rec = (await this.tx(db, 'readonly', (store) => store.get(DB_KEY))) as
        | { files: File[]; savedAt: number }
        | undefined;
      db.close();
      if (!rec || !Array.isArray(rec.files) || rec.files.length === 0) return [];
      if (Date.now() - (rec.savedAt ?? 0) > MAX_AGE_MS) {
        await this.clearFiles();
        return [];
      }
      return rec.files;
    } catch {
      return [];
    }
  }

  private async clearFiles(): Promise<void> {
    try {
      const db = await this.openDb();
      await this.tx(db, 'readwrite', (store) => store.delete(DB_KEY));
      db.close();
    } catch {
      // best effort
    }
  }

  /** Wipe the whole draft — call once the crop step is finished or abandoned. */
  clear(): void {
    try {
      sessionStorage.removeItem(STATE_KEY);
    } catch {
      // ignore
    }
    void this.clearFiles();
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) {
          req.result.createObjectStore(DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private tx<T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, mode);
      const request = op(transaction.objectStore(DB_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
