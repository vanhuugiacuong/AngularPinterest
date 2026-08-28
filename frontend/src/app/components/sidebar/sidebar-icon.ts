import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type SidebarIconName =
  'home' | 'create' | 'collage' | 'notifications' | 'messages' | 'settings' | 'auction';

const ICON_PATHS: Record<SidebarIconName, string> = {
  home:
    'M13.75 2.75v2.519M5.75 15.75v-4.5c0-.8284.6716-1.5 1.5-1.5s1.5.6716 1.5 1.5v4.5M11.25 9.75h1.5M2.655 6.45 9 1.75l6.345 4.7c.255.189.405.487.405.804v6.496a2 2 0 0 1-2 2h-9.5a2 2 0 0 1-2-2V7.254c0-.317.15-.615.405-.804Z',
  create: '',
  collage: '',
  notifications: '',
  messages:
    'M20 11.5a8 8 0 0 1-8 8 8.2 8.2 0 0 1-3.25-.67L4 20l1.35-4.2A8 8 0 1 1 20 11.5ZM9 11.5h.01M12 11.5h.01M15 11.5h.01',
  settings: 'M4 7h7M15 7h5M4 12h2M10 12h10M4 17h9M17 17h3M13 5v4M8 10v4M15 15v4',
  auction:
    'M7 10 L11 6 L15 10 L11 14 Z M11 14 L17.5 20.5 M14 20.5 L21 20.5',
};

@Component({
  selector: 'app-sidebar-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-icon]': 'icon()',
    '[class.sidebar-icon--mobile]': "size() === 'mobile'",
  },
  template: `
    <svg [attr.viewBox]="viewBox()" fill="none" aria-hidden="true" focusable="false">
      @if (icon() === 'create') {
        <path
          d="M3.76199 14.989L9.83599 8.914C10.617 8.133 11.883 8.133 12.664 8.914L15.25 11.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M13.25 2.75H4.75C3.64543 2.75 2.75 3.64543 2.75 4.75V13.25C2.75 14.3546 3.64543 15.25 4.75 15.25H13.25C14.3546 15.25 15.25 14.3546 15.25 13.25V4.75C15.25 3.64543 14.3546 2.75 13.25 2.75Z"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M6.25 8.5C6.94036 8.5 7.5 7.94036 7.5 7.25C7.5 6.55964 6.94036 6 6.25 6C5.55964 6 5 6.55964 5 7.25C5 7.94036 5.55964 8.5 6.25 8.5Z"
          fill="currentColor"
        />
      } @else if (icon() === 'collage') {
        <path
          d="M12.5717 2.92528L2.91893 12.583C2.52903 12.973 2.52863 13.6051 2.91783 13.9957L4.00304 15.0849C4.39404 15.4749 5.02703 15.4749 5.41803 15.0849L15.0701 5.42687C15.4599 5.03677 15.4604 4.40475 15.0712 4.01415L13.9874 2.92638C13.597 2.53458 12.9627 2.53408 12.5717 2.92528Z"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M10.387 5.35999L12.637 7.60999"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M7.24297 3.48999L6.29697 3.18006L5.98097 2.22998C5.87897 1.92008 5.37197 1.92008 5.26997 2.22998L4.95396 3.18006L4.00797 3.48999C3.85497 3.53999 3.75098 3.68998 3.75098 3.84998C3.75098 4.00998 3.85497 4.14995 4.00797 4.19995L4.95396 4.52014L5.26997 5.4701C5.32097 5.6201 5.46397 5.7201 5.62497 5.7201C5.78597 5.7201 5.92997 5.6201 5.97997 5.4701L6.29597 4.52014L7.24197 4.19995C7.39497 4.15005 7.49896 4.01008 7.49896 3.84998C7.49896 3.68988 7.39597 3.54009 7.24297 3.48999Z"
          fill="currentColor"
        />
        <path
          d="M16.658 11.99L15.395 11.57L14.974 10.3101C14.837 9.90005 14.162 9.90005 14.025 10.3101L13.604 11.57L12.341 11.99C12.137 12.0601 11.999 12.25 11.999 12.46C11.999 12.6801 12.137 12.8699 12.341 12.9399L13.604 13.36L14.025 14.62C14.093 14.83 14.285 14.96 14.5 14.96C14.715 14.96 14.906 14.83 14.975 14.62L15.396 13.36L16.659 12.9399C16.863 12.87 17.001 12.6801 17.001 12.46C17.001 12.25 16.862 12.0601 16.658 11.99Z"
          fill="currentColor"
        />
        <path
          d="M9.25 2.5C9.664 2.5 10 2.16 10 1.75C10 1.34 9.664 1 9.25 1C8.836 1 8.5 1.34 8.5 1.75C8.5 2.16 8.836 2.5 9.25 2.5Z"
          fill="currentColor"
        />
      } @else if (icon() === 'notifications') {
        <path
          d="M15.75 12.75C14.645 12.75 13.75 11.855 13.75 10.75V6.5C13.75 3.877 11.623 1.75 9 1.75C6.377 1.75 4.25 3.877 4.25 6.5V10.75C4.25 11.855 3.355 12.75 2.25 12.75H15.75Z"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M10.5 15.3843C10.2005 15.9018 9.6409 16.25 9 16.25C8.3591 16.25 7.7995 15.9018 7.5 15.3843"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      } @else {
        <path
          [attr.d]="path()"
          stroke="currentColor"
          [attr.stroke-width]="strokeWidth()"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      width: 44px;
      height: 44px;
      flex: 0 0 44px;
      align-items: center;
      justify-content: center;
      color: inherit;
    }

    svg {
      display: block;
      width: 23px;
      height: 23px;
      overflow: visible;
    }

    :host(.sidebar-icon--mobile) {
      width: 28px;
      height: 28px;
      flex-basis: 28px;
    }
  `,
})
export class SidebarIcon {
  public readonly icon = input.required<SidebarIconName>();
  public readonly size = input<'rail' | 'mobile'>('rail');
  protected readonly path = computed(() => ICON_PATHS[this.icon()]);
  protected readonly viewBox = computed(() =>
    this.icon() === 'home' ||
    this.icon() === 'create' ||
    this.icon() === 'collage' ||
    this.icon() === 'notifications'
      ? '0 0 18 18'
      : '0 0 24 24',
  );
  protected readonly strokeWidth = computed(() => (this.icon() === 'home' ? 1.5 : 1.9));
}
