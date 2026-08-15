import { EditorSnapshot } from './editor-types';

const MAX_HISTORY = 40;

function clone<T>(value: T): T {
  // structuredClone is available in every browser this app already targets;
  // JSON fallback kept only as a defensive last resort.
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Undo/redo stack for the editor. Stores plain-object state snapshots
 * (adjustments + caption settings) rather than bitmaps, so history stays
 * cheap regardless of image resolution.
 */
export class EditorHistory {
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Call before applying a change, passing the state as it was *before* the change. */
  commit(previousState: EditorSnapshot): void {
    this.past.push(clone(previousState));
    if (this.past.length > MAX_HISTORY) {
      this.past.shift();
    }
    this.future = [];
  }

  undo(currentState: EditorSnapshot): EditorSnapshot | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.unshift(clone(currentState));
    if (this.future.length > MAX_HISTORY) {
      this.future.pop();
    }
    return previous;
  }

  redo(currentState: EditorSnapshot): EditorSnapshot | null {
    const next = this.future.shift();
    if (!next) return null;
    this.past.push(clone(currentState));
    if (this.past.length > MAX_HISTORY) {
      this.past.shift();
    }
    return next;
  }

  reset(): void {
    this.past = [];
    this.future = [];
  }
}
