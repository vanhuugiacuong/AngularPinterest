/** Whitelist ngân hàng hỗ trợ tạo QR VietQR cho tài khoản nhận tiền của
 * người bán. Backend luôn kiểm tra `bankCode` theo danh sách này, không bao
 * giờ nhận mã ngân hàng tuỳ ý từ client. `code` khớp mã ngắn VietQR dùng
 * trong URL ảnh QR (img.vietqr.io/image/{code}-{accountNumber}-...), `bin`
 * là mã BIN theo chuẩn Napas — xác minh qua api.vietqr.io/v2/banks. */
export interface VietQrBank {
  code: string;
  bin: string;
  name: string;
}

export const SUPPORTED_BANKS: VietQrBank[] = [
  { code: 'MB', bin: '970422', name: 'MB Bank' },
  { code: 'VCB', bin: '970436', name: 'Vietcombank' },
  { code: 'TCB', bin: '970407', name: 'Techcombank' },
  { code: 'ACB', bin: '970416', name: 'ACB' },
  { code: 'BIDV', bin: '970418', name: 'BIDV' },
  { code: 'ICB', bin: '970415', name: 'VietinBank' },
  { code: 'VBA', bin: '970405', name: 'Agribank' },
  { code: 'TPB', bin: '970423', name: 'TPBank' },
  { code: 'VPB', bin: '970432', name: 'VPBank' },
  { code: 'STB', bin: '970403', name: 'Sacombank' },
  { code: 'SHB', bin: '970443', name: 'SHB' },
  { code: 'HDB', bin: '970437', name: 'HDBank' },
  { code: 'OCB', bin: '970448', name: 'OCB' },
  { code: 'MSB', bin: '970426', name: 'MSB' },
  { code: 'VIB', bin: '970441', name: 'VIB' },
  { code: 'EIB', bin: '970431', name: 'Eximbank' },
  { code: 'SEAB', bin: '970440', name: 'SeABank' },
  { code: 'NAB', bin: '970428', name: 'Nam A Bank' },
  { code: 'BAB', bin: '970409', name: 'Bac A Bank' },
  { code: 'PVCB', bin: '970412', name: 'PVcomBank' },
];

export function isSupportedBankCode(code: string): boolean {
  return SUPPORTED_BANKS.some((b) => b.code === code);
}
