import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { runHybridSearch } from '../retrieval/hybridSearch.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

/** POST /api/search — raw hybrid retrieval results (no LLM) */
searchRouter.post('/', async (req, res) => {
  const schema = z.object({
    query: z.string().min(1).max(1000),
    topK: z.number().int().min(1).max(50).optional(),
    candidates: z.number().int().min(1).max(500).optional(),
    rrfK: z.number().int().min(1).max(1000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { query, ...opts } = parsed.data;
  const results = await runHybridSearch(req.auth!.organizationId, query, opts);
  res.json({ query, count: results.length, results });
});
