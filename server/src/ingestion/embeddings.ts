import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const MAX_BATCH = 96; // OpenAI accepts up to 2048 inputs; keep batches small & safe

/**
 * Embed an array of strings, preserving order. Batched + retried with backoff.
 * Output vectors have `config.embedding.dim` dimensions (must match vector(N)).
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const slice = texts.slice(i, i + MAX_BATCH).map((t) => t.replace(/\n/g, ' '));
    const vectors = await withRetry(() =>
      openai.embeddings.create({
        model: config.embedding.model,
        input: slice,
        dimensions: config.embedding.dim,
      }),
    );
    for (const d of vectors.data.sort((a, b) => a.index - b.index)) {
      out.push(d.embedding as number[]);
    }
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedBatch([text.slice(0, 8000)]);
  return v;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let a = 0; a < attempts; a++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status && status < 500 && status !== 429) throw err; // non-retryable
      await new Promise((r) => setTimeout(r, Math.min(2 ** a * 500, 8000) + Math.random() * 250));
    }
  }
  throw lastErr;
}
