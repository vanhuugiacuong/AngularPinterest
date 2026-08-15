import { CaptionSettings, ColorAdjustments } from './editor-types';

/** Loads an image element. Sets crossOrigin for remote sources so the canvas
 * stays untainted and toBlob()/toDataURL() keep working (verified the AI
 * generation domain sends `Access-Control-Allow-Origin: *`). */
export function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Không thể tải ảnh để chỉnh sửa. Có thể do lỗi mạng hoặc ảnh chặn truy cập từ nguồn khác (CORS).'));
    img.src = src;
  });
}

export function buildCanvasFilter(a: ColorAdjustments): string {
  const parts = [`brightness(${a.brightness}%)`, `contrast(${a.contrast}%)`, `saturate(${a.saturation}%)`];
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur) parts.push(`blur(${a.blur}px)`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.sepia) parts.push(`sepia(${a.sepia}%)`);
  return parts.join(' ');
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function applyWarmth(ctx: CanvasRenderingContext2D, w: number, h: number, warmth: number): void {
  if (!warmth) return;
  const alpha = (clamp(Math.abs(warmth), 0, 100) / 100) * 0.22;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = warmth > 0 ? `rgba(255, 166, 64, ${alpha})` : `rgba(64, 140, 255, ${alpha})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${current} ${words[i]}`;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

/** Computes the caption's clamped block geometry in canvas pixel space —
 * shared by drawing and by the drag-hit-test so preview and export always
 * agree on where the caption actually sits. */
export function measureCaption(
  ctx: CanvasRenderingContext2D,
  caption: CaptionSettings,
  w: number,
  h: number
): { lines: string[]; lineHeight: number; fontSizePx: number; cx: number; cy: number; blockWidth: number; blockHeight: number } {
  const fontSizePx = Math.max(8, Math.round((caption.fontSize / 800) * w));
  const weight = caption.bold ? '800' : '500';
  ctx.font = `${weight} ${fontSizePx}px ${caption.font}`;

  const maxTextWidth = w * 0.86;
  const lines = wrapText(ctx, caption.text, maxTextWidth);
  const lineHeight = fontSizePx * 1.28;
  const blockHeight = lines.length * lineHeight;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const blockWidth = Math.min(maxTextWidth, Math.max(0, ...widths));

  const cx = clamp(caption.x, 0.06, 0.94) * w;
  const halfBlock = blockHeight / 2;
  const cy = clamp(clamp(caption.y, 0.06, 0.94) * h, halfBlock + fontSizePx * 0.3, h - halfBlock - fontSizePx * 0.3);

  return { lines, lineHeight, fontSizePx, cx, cy, blockWidth, blockHeight };
}

async function waitForCaptionFont(caption: CaptionSettings, fontSizePx: number): Promise<void> {
  const weight = caption.bold ? '800' : '500';
  const spec = `${weight} ${fontSizePx}px ${caption.font}`;
  const fonts: FontFaceSet | undefined = (document as any).fonts;
  if (!fonts?.load) return;
  try {
    await fonts.load(spec);
  } catch {
    // Best effort — fall back to whatever font resolves synchronously.
  }
}

export async function drawCaption(ctx: CanvasRenderingContext2D, caption: CaptionSettings, w: number, h: number): Promise<void> {
  if (!caption.enabled || !caption.text.trim()) return;

  // Measure with a provisional font first so metrics are stable even before
  // the exact weight/family has finished loading, then wait and re-measure.
  let metrics = measureCaption(ctx, caption, w, h);
  await waitForCaptionFont(caption, metrics.fontSizePx);
  metrics = measureCaption(ctx, caption, w, h);

  const { lines, lineHeight, fontSizePx, cx, cy, blockWidth, blockHeight } = metrics;
  ctx.textBaseline = 'middle';
  ctx.textAlign = caption.align;

  if (caption.bgEnabled) {
    const padX = fontSizePx * 0.55;
    const padY = fontSizePx * 0.4;
    const boxW = blockWidth + padX * 2;
    const boxH = blockHeight + padY * 2;
    let boxX = cx - boxW / 2;
    if (caption.align === 'left') boxX = cx - padX;
    if (caption.align === 'right') boxX = cx - boxW + padX;
    const boxY = cy - boxH / 2;
    ctx.save();
    ctx.globalAlpha = caption.bgOpacity / 100;
    ctx.fillStyle = caption.bgColor;
    roundRect(ctx, boxX, boxY, boxW, boxH, Math.min(14, boxH / 4));
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = caption.opacity / 100;
  ctx.fillStyle = caption.color;
  if (caption.shadowEnabled) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = fontSizePx * 0.22;
    ctx.shadowOffsetY = fontSizePx * 0.05;
  }
  const startY = cy - blockHeight / 2 + lineHeight / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
  ctx.restore();
}

export interface RenderParams {
  image: HTMLImageElement;
  canvas: HTMLCanvasElement;
  adjustments: ColorAdjustments;
  caption: CaptionSettings;
  /** Longest-edge cap in px. Omit for the image's natural resolution. */
  maxDimension?: number;
}

/** The single render pipeline used for both the live preview canvas and the
 * final export canvas — guarantees export pixel-matches what was previewed. */
export async function renderEditedImage(params: RenderParams): Promise<{ width: number; height: number }> {
  const { image, canvas, adjustments, caption, maxDimension } = params;
  const naturalW = image.naturalWidth || 1;
  const naturalH = image.naturalHeight || 1;
  const scale = maxDimension ? Math.min(1, maxDimension / Math.max(naturalW, naturalH)) : 1;
  const w = Math.max(1, Math.round(naturalW * scale));
  const h = Math.max(1, Math.round(naturalH * scale));

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');

  ctx.clearRect(0, 0, w, h);
  ctx.filter = buildCanvasFilter(adjustments);
  ctx.drawImage(image, 0, 0, w, h);
  ctx.filter = 'none';
  applyWarmth(ctx, w, h, adjustments.warmth);
  await drawCaption(ctx, caption, w, h);

  return { width: w, height: h };
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Xuất ảnh thất bại — không tạo được dữ liệu ảnh.'));
      },
      mimeType,
      quality
    );
  });
}
