import { Worker, type Job } from 'bullmq';
import pgvector from 'pgvector/pg';
import { connection } from '../redis.js';
import { config } from '../config.js';
import { pool, withTenant } from '../db.js';
import { getObjectBuffer } from '../storage.js';
import { parseByContentType } from './parsers.js';
import { chunkPages } from './chunker.js';
import { embedBatch } from './embeddings.js';
import type { IngestJobData } from './queue.js';

/**
 * Ingestion pipeline (runs per uploaded document):
 *   1. fetch bytes from S3/MinIO
 *   2. parse -> page texts
 *   3. clean + split into ~500-token chunks w/ 50-token overlap
 *   4. embed chunks in batches
 *   5. bulk-insert into document_chunks (embedding + generated tsvector)
 *   6. mark document ready / failed
 */
async function processJob(job: Job<IngestJobData>) {
  const { documentId, organizationId, storageKey, contentType, filename } = job.data;

  await setStatus(organizationId, documentId, 'processing', null);

  const buffer = await getObjectBuffer(storageKey);
  const parsed = await parseByContentType(contentType, filename, buffer);
  await job.updateProgress(20);

  const chunks = chunkPages(parsed.pages, {
    tokens: config.chunking.tokens,
    overlap: config.chunking.overlap,
  });
  if (chunks.length === 0) throw new Error('no extractable text');
  await job.updateProgress(40);

  const embeddings = await embedBatch(chunks.map((c) => c.content));
  await job.updateProgress(80);

  await withTenant(organizationId, async (tx) => {
    // idempotent re-run: clear any previous chunks for this document
    await tx.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);

    const cols = 8;
    const values: unknown[] = [];
    const rows: string[] = [];
    chunks.forEach((c, i) => {
      const b = i * cols;
      rows.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`,
      );
      values.push(
        organizationId,
        documentId,
        c.index,
        c.content,
        c.tokenCount,
        c.page ?? null,
        c.sectionPath ?? null,
        pgvector.toSql(embeddings[i]),
      );
    });

    await tx.query(
      `INSERT INTO document_chunks
         (organization_id, document_id, chunk_index, content, token_count, page_number, section_path, embedding)
       VALUES ${rows.join(',')}`,
      values,
    );

    await tx.query(
      `UPDATE documents
          SET status = 'ready', error = NULL, page_count = $2, chunk_count = $3
        WHERE id = $1`,
      [documentId, parsed.pageCount, chunks.length],
    );
  });

  await job.updateProgress(100);
  return { chunks: chunks.length, pages: parsed.pageCount };
}

async function setStatus(
  orgId: string,
  documentId: string,
  status: 'processing' | 'failed',
  error: string | null,
) {
  await withTenant(orgId, (tx) =>
    tx.query('UPDATE documents SET status = $2, error = $3 WHERE id = $1', [
      documentId,
      status,
      error,
    ]),
  );
}

const worker = new Worker<IngestJobData>(config.ingestQueue, processJob, {
  connection,
  concurrency: config.ingestConcurrency,
});

worker.on('completed', (job, res) =>
  console.log(`[ingest] ${job.id} ok`, res),
);
worker.on('failed', async (job, err) => {
  console.error(`[ingest] ${job?.id} failed:`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await setStatus(job.data.organizationId, job.data.documentId, 'failed', err.message).catch(
      () => undefined,
    );
  }
});

async function shutdown() {
  console.log('[ingest] shutting down…');
  await worker.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(
  `[ingest] worker up — queue="${config.ingestQueue}" concurrency=${config.ingestConcurrency}`,
);
