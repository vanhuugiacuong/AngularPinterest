/** Danh sách ngân hàng hỗ trợ tạo QR VietQR — phải khớp whitelist
 * `SUPPORTED_BANKS` ở backend (`backend/src/memberships/vietqr-banks.ts`).
 * Backend luôn validate lại `bankCode`, danh sách này chỉ để hiển thị dropdown. */
export interface VietQrBank {
  code: string;
  name: string;
}

export const SUPPORTED_BANKS: VietQrBank[] = [
  { code: 'MB', name: 'MB Bank' },
  { code: 'VCB', name: 'Vietcombank' },
  { code: 'TCB', name: 'Techcombank' },
  { code: 'ACB', name: 'ACB' },
  { code: 'BIDV', name: 'BIDV' },
  { code: 'ICB', name: 'VietinBank' },
  { code: 'VBA', name: 'Agribank' },
  { code: 'TPB', name: 'TPBank' },
  { code: 'VPB', name: 'VPBank' },
  { code: 'STB', name: 'Sacombank' },
  { code: 'SHB', name: 'SHB' },
  { code: 'HDB', name: 'HDBank' },
  { code: 'OCB', name: 'OCB' },
  { code: 'MSB', name: 'MSB' },
  { code: 'VIB', name: 'VIB' },
  { code: 'EIB', name: 'Eximbank' },
  { code: 'SEAB', name: 'SeABank' },
  { code: 'NAB', name: 'Nam A Bank' },
  { code: 'BAB', name: 'Bac A Bank' },
  { code: 'PVCB', name: 'PVcomBank' },
];

/** Ảnh QR VietQR cho một giao dịch chuyển khoản tới đúng tài khoản người
 * bán — thay cho tài khoản chung của platform trước đây. */
export function buildVietQrUrl(
  bankCode: string,
  accountNumber: string,
  amountVnd: number,
  addInfo: string,
  accountName: string,
): string {
  return `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(accountNumber)}-compact2.png?amount=${amountVnd}&addInfo=${encodeURIComponent(addInfo)}&accountName=${encodeURIComponent(accountName)}`;
}
