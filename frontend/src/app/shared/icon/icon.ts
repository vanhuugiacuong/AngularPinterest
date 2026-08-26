import { Component, Input } from '@angular/core';

/**
 * Bộ icon monoline hiện đại (kiểu Lucide) dùng riêng cho các trang thương mại
 * (Pro / Ví / Thanh toán). SVG inline, stroke = currentColor -> tô màu bằng CSS
 * text color. Kích thước điều khiển bằng class (w-* h-*). Không phụ thuộc CDN.
 *
 *   <app-icon name="coin" class="w-6 h-6 text-[#F94083]" />
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    @switch (name) {
      @case ('coin') {
        <!-- Xu credit filled nhiều màu (kiểu token) — màu cố định, không theo currentColor -->
        <svg viewBox="0 0 24 24" fill="none" class="w-full h-full">
          <circle cx="12" cy="13" r="9" fill="#2f2150" />
          <circle cx="12" cy="11.4" r="9" fill="#c05fe0" />
          <circle cx="12" cy="11.4" r="6.5" fill="#3a2a5e" />
          <path d="M12 6.7l1.36 3.13 3.4.29-2.58 2.24.79 3.32L12 14.28l-2.97 1.71.79-3.32-2.58-2.24 3.4-.29L12 6.7Z" fill="#eaa8f5" />
          <path d="M12 6.7l1.36 3.13 3.4.29-2.58 2.24.79 3.32L12 14.28V6.7Z" fill="#d47ceb" />
          <path d="M17.7 4.6l.5 1.45 1.45.5-1.45.5-.5 1.45-.5-1.45-1.45-.5 1.45-.5.5-1.45Z" fill="#ffffff" />
        </svg>
      }
      @case ('crown') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M3 8l3.2 3.2L12 5l5.8 6.2L21 8l-1.5 10.5A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5L3 8Z" />
          <path d="M8 20h8" opacity="0.6" />
        </svg>
      }
      @case ('spark') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
          <path d="M19 15l.7 1.9L21.6 17l-1.9.7L19 19.6l-.7-1.9L16.4 17l1.9-.7L19 15Z" opacity="0.7" />
        </svg>
      }
      @case ('hd') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M7.5 9.5v5M7.5 12H10M10 9.5v5" />
          <path d="M13 9.5v5h1.6a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2H13Z" />
        </svg>
      }
      @case ('download') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      }
      @case ('lock') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
          <circle cx="12" cy="15.3" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      }
      @case ('infinity') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M7 9c-2 0-3.3 1.4-3.3 3s1.3 3 3.3 3c2.7 0 3.3-6 6-6 2 0 3.3 1.4 3.3 3s-1.3 3-3.3 3c-2.7 0-3.3-6-6-6Z" />
        </svg>
      }
      @case ('check') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.2 12.4l2.6 2.6 5-5.4" />
        </svg>
      }
      @case ('x') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      }
      @case ('clock') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      }
      @case ('qr') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5" />
          <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5" />
          <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5" />
          <path d="M14 14h3m3 0v3m0 3h-6.5v-3M17 20.5h.01M20.5 17h.01" />
        </svg>
      }
      @case ('wallet') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5a1 1 0 0 1 1 1V8" />
          <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
          <path d="M20.5 12.5H17a2 2 0 0 0 0 4h3.5" />
          <circle cx="17" cy="14.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      }
      @case ('receipt') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M6 3.5h12v17l-2.2-1.4-2.4 1.4L11 20.6l-2.4 1.4L6 20.6V3.5Z" />
          <path d="M9.5 8h5M9.5 11.5h5" />
        </svg>
      }
      @case ('arrow-right') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M5 12h14m0 0-5.5-5.5M19 12l-5.5 5.5" />
        </svg>
      }
      @case ('shield') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M12 3l7 3v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6l7-3Z" />
          <path d="M9 12l2 2 4-4.2" />
        </svg>
      }
      @case ('sync') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4" />
          <path d="M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4" />
        </svg>
      }
      @case ('bank') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M4 10 12 4l8 6" />
          <path d="M5 10v8m4-8v8m6-8v8m4-8v8M3.5 20.5h17" />
        </svg>
      }
      @case ('copy') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <rect x="9" y="9" width="11" height="11" rx="2.5" />
          <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
        </svg>
      }
      @case ('plus') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M12 5v14M5 12h14" />
        </svg>
      }
      @default {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" class="w-full h-full"><circle cx="12" cy="12" r="9" /></svg>
      }
    }
  `,
  styles: [':host{display:inline-flex;align-items:center;justify-content:center;line-height:0}'],
})
export class Icon {
  @Input() name = '';
}
