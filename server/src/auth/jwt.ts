import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { AuthPrincipal } from './types.js';

type TokenClaims = AuthPrincipal & { iat?: number; exp?: number };

export function signToken(principal: AuthPrincipal): string {
  return jwt.sign(principal, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthPrincipal {
  const claims = jwt.verify(token, config.auth.jwtSecret) as TokenClaims;
  return {
    userId: claims.userId,
    organizationId: claims.organizationId,
    email: claims.email,
    role: claims.role,
  };
}
