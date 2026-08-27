import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CollageTransferService {
  private pendingFile: File | null = null;

  set(file: File): void {
    this.pendingFile = file;
  }

  take(): File | null {
    const file = this.pendingFile;
    this.pendingFile = null;
    return file;
  }
}
