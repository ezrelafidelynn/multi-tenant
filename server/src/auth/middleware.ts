import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from './jwt.js';
import type { Role } from './types.js';

/** Bearer token OR `access_token` query param (EventSource can't set headers). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token = bearer ?? (typeof req.query.access_token === 'string' ? req.query.access_token : undefined);

  if (!token) return res.status(401).json({ error: 'missing bearer token' });
  try {
    req.auth = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

const RANK: Record<Role, number> = { viewer: 1, member: 2, admin: 3 };

/** Role gate. `requireRole('member')` allows member + admin. */
export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
    if (RANK[req.auth.role] < RANK[min]) {
      return res.status(403).json({ error: `requires ${min} role` });
    }
    return next();
  };
}
