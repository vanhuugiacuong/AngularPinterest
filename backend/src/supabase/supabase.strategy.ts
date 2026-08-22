import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor() {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      console.warn('SUPABASE_JWT_SECRET is not defined in environment variables.');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret || 'temporary-fallback-secret-key-change-me',
    });
  }

  async validate(payload: any) {
    if (!payload) {
      throw new UnauthorizedException();
    }
    // Supabase JWT stores the user's UUID in the 'sub' field, and email in 'email'
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}
