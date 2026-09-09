import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { withTenant } from '../db.js';
import { chatStreamController } from '../chat/stream.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

/** POST /api/chat/stream — SSE token stream with grounded citations */
chatRouter.post('/stream', chatStreamController);

/** GET /api/chat/conversations — list current user's threads */
chatRouter.get('/conversations', async (req, res) => {
  const { organizationId, userId } = req.auth!;
  const rows = await withTenant(organizationId, (tx) =>
    tx.query(
      `SELECT id, title, created_at FROM conversations
        WHERE organization_id = $1 AND user_id = $2
        ORDER BY created_at DESC LIMIT 100`,
      [organizationId, userId],
    ),
  );
  res.json({ conversations: rows.rows });
});

/** GET /api/chat/conversations/:id/messages */
chatRouter.get('/conversations/:id/messages', async (req, res) => {
  const { organizationId, userId } = req.auth!;
  const rows = await withTenant(organizationId, async (tx) => {
    const owned = await tx.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, userId],
    );
    if (owned.rowCount === 0) return null;
    return tx.query(
      `SELECT role, content, citations, created_at FROM messages
        WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [req.params.id],
    );
  });
  if (!rows) return res.status(404).json({ error: 'not found' });
  res.json({ messages: rows.rows });
});
