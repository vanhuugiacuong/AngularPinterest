export const NOVATOKEN_VND_RATE = 1_000;

export function vndToNovaToken(value: string | number | null | undefined): number {
  return Math.max(1, Math.ceil(Number(value ?? 0) / NOVATOKEN_VND_RATE));
}

export function formatNovaToken(value: string | number | null | undefined): string {
  return `${Number(value ?? 0).toLocaleString('vi-VN')} NT`;
}
