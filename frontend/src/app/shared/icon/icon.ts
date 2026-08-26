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
        <!-- Vương miện filled (đính ngọc) — theo currentColor để đồng bộ màu -->
        <svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full">
          <path d="M2.9 8.05c-.53-.33-1.16.2-.98.8l1.98 6.9c.13.44.53.75.99.75h14.22c.46 0 .86-.31.99-.75l1.98-6.9c.18-.6-.45-1.13-.98-.8l-3.9 2.44c-.42.26-.97.12-1.2-.32L12.9 4.9c-.4-.75-1.47-.75-1.87 0L8.99 10.17c-.24.44-.79.58-1.2.32L2.9 8.05Z" />
          <path fill-rule="evenodd" d="M5 17.4h14c.6 0 1.05.5 1 1.1-.06.62-.28 1.13-.98 1.4-1.5.57-4.02.9-7.02.9s-5.52-.33-7.02-.9c-.7-.27-.92-.78-.98-1.4-.05-.6.4-1.1 1-1.1Zm7 .95a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-4.2.35a.72.72 0 1 0 0 1.44.72.72 0 0 0 0-1.44Zm8.4 0a.72.72 0 1 0 0 1.44.72.72 0 0 0 0-1.44Z" clip-rule="evenodd" />
        </svg>
      }
      @case ('spark') {
        <!-- Tia sáng (✨) filled, 3 ngôi sao 4 cánh -->
        <svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full">
          <path d="M9 3.2c.2 0 .38.13.44.32l1.06 3.34a1 1 0 0 0 .64.64l3.34 1.06c.4.13.4.7 0 .82l-3.34 1.06a1 1 0 0 0-.64.64L9.44 14.5a.46.46 0 0 1-.88 0L7.5 11.16a1 1 0 0 0-.64-.64L3.52 9.46c-.4-.12-.4-.69 0-.82l3.34-1.06a1 1 0 0 0 .64-.64l1.06-3.4A.46.46 0 0 1 9 3.2Z" />
          <path d="M17.6 4.4c.16 0 .3.1.35.25l.63 1.86a.7.7 0 0 0 .44.44l1.86.63c.3.1.3.52 0 .62l-1.86.63a.7.7 0 0 0-.44.44l-.63 1.86a.37.37 0 0 1-.7 0l-.63-1.86a.7.7 0 0 0-.44-.44l-1.86-.63c-.3-.1-.3-.52 0-.62l1.86-.63a.7.7 0 0 0 .44-.44l.63-1.86a.37.37 0 0 1 .35-.25Z" opacity="0.85" />
          <path d="M17 14.2c.15 0 .28.1.33.24l.53 1.6a.7.7 0 0 0 .44.44l1.6.53c.28.1.28.5 0 .6l-1.6.53a.7.7 0 0 0-.44.44l-.53 1.6a.35.35 0 0 1-.66 0l-.53-1.6a.7.7 0 0 0-.44-.44l-1.6-.53c-.28-.1-.28-.5 0-.6l1.6-.53a.7.7 0 0 0 .44-.44l.53-1.6a.35.35 0 0 1 .33-.24Z" opacity="0.85" />
        </svg>
      }
      @case ('hd') {
        <!-- Badge HD / 4K filled -->
        <svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full">
          <rect x="2.3" y="4.6" width="19.4" height="14.8" rx="3" />
          <text x="12" y="13.2" text-anchor="middle" font-size="6.4" font-weight="800" letter-spacing="0.2" fill="#fff" style="font-family:inherit">HD</text>
          <text x="12" y="18.1" text-anchor="middle" font-size="3.9" font-weight="800" letter-spacing="0.4" fill="#fff" style="font-family:inherit">4K</text>
        </svg>
      }
      @case ('download') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      }
      @case ('lock') {
        <!-- Ổ khoá filled (quai + thân + lỗ khoá) -->
        <svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full">
          <path d="M8.4 10.2V8a3.6 3.6 0 0 1 7.2 0v2.2h-2V8a1.6 1.6 0 0 0-3.2 0v2.2H8.4Z" />
          <path fill-rule="evenodd" d="M6.2 10.2h11.6c1.16 0 2.1.94 2.1 2.1v6.4c0 1.16-.94 2.1-2.1 2.1H6.2a2.1 2.1 0 0 1-2.1-2.1v-6.4c0-1.16.94-2.1 2.1-2.1Zm5.8 3.6a1.7 1.7 0 0 0-.95 3.11v1.44a.95.95 0 0 0 1.9 0v-1.44A1.7 1.7 0 0 0 12 13.8Z" clip-rule="evenodd" />
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
