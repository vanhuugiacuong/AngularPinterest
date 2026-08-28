export const NOVATOKEN_VND_RATE = 1;

export function vndToNovaToken(value: string | number | null | undefined): number {
  return Math.max(0, Math.ceil(Number(value ?? 0)));
}

export function formatNovaToken(value: string | number | null | undefined): string {
  return `${Number(value ?? 0).toLocaleString('vi-VN')}đ`;
}
