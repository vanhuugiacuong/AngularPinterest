import { createPublicKey } from 'crypto';
import * as jwt from 'jsonwebtoken';

/**
 * Tra khoá và kiểm chữ ký token Supabase — dùng chung cho HTTP (SupabaseStrategy),
 * WebSocket (NotificationsGateway) và các endpoint công khai có cá nhân hoá.
 *
 * Dự án này ký ES256 (khoá bất đối xứng, công bố qua JWKS). Chỗ nào chỉ biết
 * HS256 với SUPABASE_JWT_SECRET thì token thật LUÔN kiểm hỏng — đó là lý do
 * trước đây khắp nơi phải có đường tắt "giải mã base64 rồi tin luôn".
 */

const ALGS: jwt.Algorithm[] = ['ES256', 'RS256', 'HS256'];

/** Khoá công khai dạng PEM theo `kid`. Dùng PEM (không phải KeyObject) vì kiểu
    của passport-jwt chỉ nhận string|Buffer. */
const keyCache = new Map<string, string>();
let lastFetch = 0;

/** Header token — CHỈ để biết dùng khoá nào, chưa hề được kiểm chứng. */
function readHeader(rawJwt: string): { alg?: unknown; kid?: unknown } | null {
  try {
    const seg = rawJwt.split('.')[0];
    if (!seg) return null;
    return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function publicKey(kid: string, supabaseUrl: string): Promise<string> {
  const cached = keyCache.get(kid);
  if (cached) return cached;

  // Chặn tần suất: token rác với kid ngẫu nhiên không được bắt backend gọi
  // Supabase liên tục.
  const now = Date.now();
  if (now - lastFetch < 60_000) throw new Error(`Chưa có khoá công khai cho kid ${kid}.`);
  lastFetch = now;

  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`Không tải được JWKS (HTTP ${res.status}).`);

  const body = (await res.json()) as { keys?: Record<string, unknown>[] };
  for (const jwk of body.keys ?? []) {
    if (typeof jwk.kid !== 'string') continue;
    try {
      const pem = createPublicKey({ key: jwk as any, format: 'jwk' })
        .export({ type: 'spki', format: 'pem' })
        .toString();
      keyCache.set(jwk.kid, pem);
    } catch {
      /* khoá lạ kiểu -> bỏ qua, khoá khác vẫn dùng được */
    }
  }

  const key = keyCache.get(kid);
  if (!key) throw new Error(`JWKS không có khoá khớp kid ${kid}.`);
  return key;
}

/** Chọn khoá theo `alg` của chính token: HS* -> bí mật cũ, còn lại -> JWKS. */
export async function keyForToken(rawJwt: string): Promise<string> {
  const header = readHeader(rawJwt);
  if (!header) throw new Error('Token không đọc được phần header.');

  if (typeof header.alg === 'string' && header.alg.startsWith('HS')) {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) throw new Error('Token ký HS256 nhưng thiếu SUPABASE_JWT_SECRET.');
    return secret;
  }

  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('Token ký bất đối xứng nhưng thiếu SUPABASE_URL.');
  if (typeof header.kid !== 'string') throw new Error('Token thiếu `kid`.');

  return publicKey(header.kid, url);
}

/**
 * Kiểm chữ ký đầy đủ. Trả về payload, hoặc null nếu token thiếu / sai chữ ký /
 * hết hạn. Không bao giờ ném ra ngoài.
 */
export async function verifySupabaseToken(rawJwt?: string): Promise<jwt.JwtPayload | null> {
  if (!rawJwt) return null;
  try {
    const key = await keyForToken(rawJwt);
    const payload = jwt.verify(rawJwt, key as any, { algorithms: ALGS });
    return typeof payload === 'string' ? null : payload;
  } catch {
    return null;
  }
}

/** Lấy id người dùng từ header Authorization, chỉ khi chữ ký hợp lệ. */
export async function verifiedUserIdFromHeader(authHeader?: string): Promise<string | undefined> {
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  const payload = await verifySupabaseToken(authHeader.slice(7).trim());
  return typeof payload?.sub === 'string' ? payload.sub : undefined;
}
