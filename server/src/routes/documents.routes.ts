import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { withTenant } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildStorageKey, putObject, presignGet, deleteObject } from '../storage.js';
import { enqueueIngest } from '../ingestion/queue.js';

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

const ACCEPTED = new Set(['application/pdf', 'text/markdown', 'text/plain', 'application/octet-stream']);

/** POST /api/documents  (multipart: file, title?) — members+ only */
documentsRouter.post('/', requireRole('member'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file field required' });

  const looksPdf = file.originalname.toLowerCase().endsWith('.pdf');
  const looksMd = /\.(md|markdown|txt)$/i.test(file.originalname);
  if (!ACCEPTED.has(file.mimetype) && !looksPdf && !looksMd) {
    return res.status(415).json({ error: `unsupported type ${file.mimetype}` });
  }
  const contentType = looksPdf ? 'application/pdf' : looksMd ? 'text/markdown' : file.mimetype;

  const { organizationId, userId } = req.auth!;
  const storageKey = buildStorageKey(organizationId, file.originalname);
  const checksum = createHash('sha256').update(file.buffer).digest('hex');

  await putObject(storageKey, file.buffer, contentType);

  const doc = await withTenant(organizationId, async (tx) => {
    const r = await tx.query(
      `INSERT INTO documents
         (organization_id, uploaded_by, title, filename, content_type, byte_size, storage_key, checksum_sha256, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING id, title, filename, status, created_at`,
      [
        organizationId,
        userId,
        (req.body.title as string)?.trim() || file.originalname,
        file.originalname,
        contentType,
        file.size,
        storageKey,
        checksum,
      ],
    );
    return r.rows[0];
  });

  await enqueueIngest({
    documentId: doc.id,
    organizationId,
    storageKey,
    contentType,
    filename: file.originalname,
  });

  res.status(202).json({ document: doc });
});

/** GET /api/documents — list for the tenant */
documentsRouter.get('/', async (req, res) => {
  const { organizationId } = req.auth!;
  const rows = await withTenant(organizationId, (tx) =>
    tx.query(
      `SELECT id, title, filename, content_type, byte_size, status, error,
              page_count, chunk_count, created_at, updated_at
         FROM documents
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 200`,
      [organizationId],
    ),
  );
  res.json({ documents: rows.rows });
});

/** GET /api/documents/:id — metadata + short-lived download URL */
documentsRouter.get('/:id', async (req, res) => {
  const { organizationId } = req.auth!;
  const rows = await withTenant(organizationId, (tx) =>
    tx.query(
      `SELECT * FROM documents WHERE id = $1 AND organization_id = $2`,
      [req.params.id, organizationId],
    ),
  );
  const doc = rows.rows[0];
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json({ document: doc, downloadUrl: await presignGet(doc.storage_key) });
});

/** GET /api/documents/:id/chunks/:index — exact snippet for a citation drawer */
documentsRouter.get('/:id/chunks/:index', async (req, res) => {
  const { organizationId } = req.auth!;
  const rows = await withTenant(organizationId, (tx) =>
    tx.query(
      `SELECT c.id, c.chunk_index, c.page_number, c.content, c.section_path,
              d.title AS document_title, d.filename
         FROM document_chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.document_id = $1 AND c.chunk_index = $2 AND c.organization_id = $3`,
      [req.params.id, Number(req.params.index), organizationId],
    ),
  );
  if (!rows.rows[0]) return res.status(404).json({ error: 'not found' });
  res.json({ chunk: rows.rows[0] });
});

/** DELETE /api/documents/:id — admin only */
documentsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const { organizationId } = req.auth!;
  const rows = await withTenant(organizationId, (tx) =>
    tx.query(
      `DELETE FROM documents WHERE id = $1 AND organization_id = $2 RETURNING storage_key`,
      [req.params.id, organizationId],
    ),
  );
  if (!rows.rows[0]) return res.status(404).json({ error: 'not found' });
  await deleteObject(rows.rows[0].storage_key).catch(() => undefined);
  res.status(204).end();
});
