import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { keyForToken } from './supabase-jwt';

/**
 * Xác thực token Supabase.
 *
 * Supabase có HAI kiểu ký và dự án này dùng kiểu MỚI: ES256 bất đối xứng, khoá
 * công khai công bố ở <SUPABASE_URL>/auth/v1/.well-known/jwks.json. Trước đây
 * chỗ này chỉ biết HS256 với SUPABASE_JWT_SECRET nên token thật LUÔN kiểm hỏng
 * — app chạy được chỉ nhờ một đường tắt trong SupabaseAuthGuard: kiểm chữ ký
 * hỏng thì giải mã base64 rồi tin luôn payload. Nghĩa là thực tế chưa request
 * nào từng được xác thực thật, ai bịa token cũng vào được.
 *
 * Việc chọn khoá theo `alg`/`kid` nằm ở supabase-jwt.ts để WebSocket và các
 * endpoint công khai có cá nhân hoá dùng chung đúng một cách kiểm.
 */
@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor() {
    if (!process.env.SUPABASE_URL && !process.env.SUPABASE_JWT_SECRET) {
      throw new Error(
        'Cần SUPABASE_URL (khoá bất đối xứng) hoặc SUPABASE_JWT_SECRET (bí mật cũ) để xác thực token.',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['ES256', 'RS256', 'HS256'],
      secretOrKeyProvider: (
        _req: unknown,
        rawJwt: string,
        done: (err: Error | null, key?: string) => void,
      ) => {
        keyForToken(rawJwt)
          .then((key) => done(null, key))
          .catch((err) => done(err instanceof Error ? err : new Error(String(err))));
      },
    });
  }

  async validate(payload: any) {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }
    // Supabase để UUID người dùng ở 'sub', email ở 'email'.
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}
