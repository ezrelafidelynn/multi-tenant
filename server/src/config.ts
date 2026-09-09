import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load server/.env if present, otherwise the shared repo-root .env.
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [join(here, '..', '.env'), join(here, '..', '..', '.env')]) {
  if (existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

/** Resolve env from server/.env or the repo-root .env (docker-compose shares it). */
function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${key}`);
  return v;
}
const num = (key: string, fallback: number) => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : Number(v);
};

export const config = {
  port: num('PORT', 4000),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:3000'),

  databaseUrl: env('DATABASE_URL'),

  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  ingestQueue: env('INGEST_QUEUE_NAME', 'docusphere:ingest'),
  ingestConcurrency: num('INGEST_CONCURRENCY', 4),

  s3: {
    endpoint: env('S3_ENDPOINT', 'http://localhost:9000'),
    region: env('S3_REGION', 'us-east-1'),
    bucket: env('S3_BUCKET', 'docusphere-documents'),
    accessKeyId: env('S3_ACCESS_KEY_ID', 'minioadmin'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY', 'minioadmin'),
    forcePathStyle: env('S3_FORCE_PATH_STYLE', 'true') === 'true',
  },

  auth: {
    jwtSecret: env('JWT_SECRET', 'dev-insecure-secret'),
    jwtExpiresIn: env('JWT_EXPIRES_IN', '12h'),
    bcryptRounds: num('BCRYPT_ROUNDS', 12),
  },

  embedding: {
    provider: env('EMBEDDING_PROVIDER', 'openai'),
    model: env('EMBEDDING_MODEL', 'text-embedding-3-small'),
    dim: num('EMBEDDING_DIM', 1536),
  },
  llm: {
    provider: env('LLM_PROVIDER', 'openai') as 'openai' | 'anthropic' | 'gemini',
    model: env('LLM_MODEL', 'gpt-4o'),
  },
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',

  retrieval: {
    topK: num('RETRIEVAL_TOP_K', 8),
    candidates: num('RETRIEVAL_CANDIDATES', 40),
    rrfK: num('RRF_K', 60),
    hnswEfSearch: num('HNSW_EF_SEARCH', 100),
  },
  chunking: {
    tokens: num('CHUNK_TOKENS', 500),
    overlap: num('CHUNK_OVERLAP', 50),
  },
  maxUploadBytes: num('MAX_UPLOAD_MB', 25) * 1024 * 1024,
};

export type Config = typeof config;
