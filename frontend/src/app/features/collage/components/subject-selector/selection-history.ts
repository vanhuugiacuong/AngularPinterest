const MAX_HISTORY_DEPTH = 30;

/** Per-stroke undo/redo for a selection mask. Each stroke's PRE-stroke mask
 * is pushed onto the undo stack right before the stroke's result is
 * applied — so undo restores exactly "the state before this stroke", not a
 * running diff, which keeps the logic trivial at the cost of one mask
 * snapshot (a plain Uint8Array, working-resolution-sized — a few hundred KB
 * at most) per stroke. Capped at MAX_HISTORY_DEPTH entries so a long
 * editing session can't grow this unbounded. */
export class SelectionHistory {
  private undoStack: Uint8Array[] = [];
  private redoStack: Uint8Array[] = [];

  /** Call with the mask as it was BEFORE the stroke that's about to be
   * committed. Clears the redo stack, matching standard undo/redo semantics
   * (a new action invalidates any previously-undone future). */
  recordBeforeStroke(previousMask: Uint8Array): void {
    this.undoStack.push(previousMask.slice());
    if (this.undoStack.length > MAX_HISTORY_DEPTH) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(currentMask: Uint8Array): Uint8Array | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(currentMask.slice());
    return previous;
  }

  redo(currentMask: Uint8Array): Uint8Array | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(currentMask.slice());
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
