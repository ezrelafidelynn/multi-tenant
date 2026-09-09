export type Role = 'admin' | 'member' | 'viewer';

export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPrincipal;
    }
  }
}
