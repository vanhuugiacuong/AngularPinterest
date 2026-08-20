export interface ColorAdjustments {
  brightness: number; // % — 0 to 200, default 100
  contrast: number;   // % — 0 to 200, default 100
  saturation: number; // % — 0 to 200, default 100
  warmth: number;     // -100 to 100, default 0 (cool <-> warm)
  hue: number;        // deg — -180 to 180, default 0
  blur: number;       // px — 0 to 8, default 0
  grayscale: number;  // % — 0 to 100, default 0
  sepia: number;      // % — 0 to 100, default 0
}

export const DEFAULT_ADJUSTMENTS: ColorAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
};

export type CaptionAlign = 'left' | 'center' | 'right';
export type CaptionPositionPreset = 'top' | 'center' | 'bottom';

export interface CaptionSettings {
  enabled: boolean;
  text: string;
  font: string;      // CSS font-family value, from SUPPORTED_FONTS
  fontSize: number;  // relative unit, scaled against an 800px reference width
  color: string;
  align: CaptionAlign;
  bold: boolean;
  opacity: number;    // % — 0 to 100
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number;  // % — 0 to 100
  shadowEnabled: boolean;
  x: number; // normalized 0-1, horizontal center of the caption block
  y: number; // normalized 0-1, vertical center of the caption block
}

export const DEFAULT_CAPTION: CaptionSettings = {
  enabled: false,
  text: '',
  font: "'Inter', ui-sans-serif, system-ui, sans-serif",
  fontSize: 42,
  color: '#f7f7ff',
  align: 'center',
  bold: true,
  opacity: 100,
  bgEnabled: true,
  bgColor: '#06060f',
  bgOpacity: 45,
  shadowEnabled: true,
  x: 0.5,
  y: 0.85,
};

export interface FontOption {
  label: string;
  value: string;
}

// System-available stacks only — no webfont loading/new dependency required,
// and every stack here renders Vietnamese diacritics correctly in evergreen
// browsers.
export const SUPPORTED_FONTS: FontOption[] = [
  { label: 'Inter', value: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  { label: 'Serif', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Mono', value: "ui-monospace, 'Courier New', monospace" },
];

export interface ColorPreset {
  label: string;
  adjustments: Partial<ColorAdjustments>;
}

// Presets only set a starting point on top of DEFAULT_ADJUSTMENTS — the user
// can still fine-tune every slider afterwards.
export const COLOR_PRESETS: ColorPreset[] = [
  { label: 'Original', adjustments: {} },
  { label: 'Vivid', adjustments: { contrast: 116, saturation: 134, brightness: 104 } },
  { label: 'Cool', adjustments: { warmth: -32, saturation: 106, brightness: 102 } },
  { label: 'Warm', adjustments: { warmth: 30, saturation: 108 } },
  { label: 'Mono', adjustments: { grayscale: 100, contrast: 112 } },
  { label: 'Cinematic', adjustments: { contrast: 118, saturation: 90, warmth: 12, brightness: 96 } },
];

export interface EditorSnapshot {
  adjustments: ColorAdjustments;
  caption: CaptionSettings;
}

export function createDefaultSnapshot(): EditorSnapshot {
  return {
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    caption: { ...DEFAULT_CAPTION },
  };
}
