import { Component, OnDestroy, OnInit, signal } from '@angular/core';

/**
 * App-wide "you're offline" banner — the one system state nothing else in
 * the app surfaces on its own (individual load/fetch errors are handled
 * per-page, but a dropped connection can happen mid-session with no fetch
 * in flight to catch it). Mounted once at the app root.
 */
@Component({
  selector: 'app-offline-banner',
  standalone: true,
  templateUrl: './offline-banner.html',
})
export class OfflineBanner implements OnInit, OnDestroy {
  public readonly isOffline = signal(typeof navigator !== 'undefined' ? !navigator.onLine : false);

  private readonly onOffline = () => this.isOffline.set(true);
  private readonly onOnline = () => this.isOffline.set(false);

  ngOnInit(): void {
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
  }

  ngOnDestroy(): void {
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
  }
}
