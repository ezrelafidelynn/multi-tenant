import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { config } from '../config.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';

export const authRouter = Router();

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';

/** Register a brand-new organization + its first admin user. */
authRouter.post('/register', async (req, res) => {
  const schema = z.object({
    organization: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organization, email, password } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const org = await client.query(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [organization, `${slugify(organization)}-${Math.random().toString(36).slice(2, 6)}`],
    );
    const orgId = org.rows[0].id as string;
    const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const user = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin') RETURNING id, email, role`,
      [orgId, email, hash],
    );
    await client.query('COMMIT');
    const u = user.rows[0];
    const principal = { userId: u.id, organizationId: orgId, email: u.email, role: u.role };
    res.status(201).json({ token: signToken(principal), user: principal });
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505')
      return res.status(409).json({ error: 'organization or email already exists' });
    throw err;
  } finally {
    client.release();
  }
});

authRouter.post('/login', async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string(), organizationId: z.string().uuid().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, organizationId } = parsed.data;

  // Email is unique per org; if a user belongs to multiple orgs, organizationId disambiguates.
  const rows = await query<{
    id: string; organization_id: string; email: string; role: string; password_hash: string;
  }>(
    `SELECT id, organization_id, email, role, password_hash
       FROM users
      WHERE email = $1 ${organizationId ? 'AND organization_id = $2' : ''}
      ORDER BY created_at ASC LIMIT 1`,
    organizationId ? [email, organizationId] : [email],
  );
  const user = rows.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const principal = {
    userId: user.id,
    organizationId: user.organization_id,
    email: user.email,
    role: user.role as 'admin' | 'member' | 'viewer',
  };
  res.json({ token: signToken(principal), user: principal });
});

authRouter.get('/me', requireAuth, (req, res) => res.json(req.auth));
