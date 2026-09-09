import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { authRouter } from './routes/auth.routes.js';
import { documentsRouter } from './routes/documents.routes.js';
import { searchRouter } from './routes/search.routes.js';
import { chatRouter } from './routes/chat.routes.js';

const app = express();
app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/search', searchRouter);
app.use('/api/chat', chatRouter);

// centralised error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({ error: err instanceof Error ? err.message : 'internal error' });
});

const server = app.listen(config.port, () => {
  console.log(`[api] DocuSphere API on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
