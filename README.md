# DocuSphere

Multi-tenant enterprise document search and chat with **hybrid retrieval** (PostgreSQL
full-text search + `pgvector` dense vectors), asynchronous ingestion, and real-time
token streaming over SSE.

```
┌──────────────┐   upload    ┌───────────────┐   enqueue   ┌──────────────┐
│  Next.js UI  │ ──────────▶ │  Express API  │ ──────────▶ │ Redis/BullMQ │
└──────┬───────┘             └───────┬───────┘             └──────┬───────┘
       │  SSE /api/chat/stream       │                            │
       │                             ▼                            ▼
       │                    ┌────────────────┐          ┌──────────────────┐
       │                    │  PostgreSQL    │◀─────────│ Ingestion worker │
       │                    │  + pgvector    │  chunks  │ parse/chunk/embed│
       │                    │  + tsvector    │  + embeds└────────┬─────────┘
       │                    └────────────────┘                   │ get file
       └────────────────────────────────────────────────┐        ▼
                                                        │  ┌───────────┐
                                                        └─▶│  MinIO/S3 │
                                                           └───────────┘
```

## Layout

| Path            | Description                                                        |
| --------------- | ---------------------------------------------------------------------|
| `server/`       | Express + TypeScript API, BullMQ worker, retrieval + chat engine    |
| `server/migrations/001_init.sql` | Full schema: pgvector, HNSW, GIN, RLS         |
| `web/`          | Next.js 15 App Router chat UI, streaming reader hook               |
| `docker-compose.yml` | Postgres (`pgvector/pgvector:pg16`), Redis, MinIO            |

## Quick start

```bash
cp .env.example .env                 # fill in OPENAI_API_KEY at minimum
docker compose up -d                 # postgres + redis + minio
cd server && npm install
npm run migrate                      # applies migrations/001_init.sql
npm run dev                          # API on :4000
npm run worker                       # ingestion worker (separate terminal)
cd ../web && npm install && npm run dev   # UI on :3000
```

Register an organization + admin user:

```bash
curl -X POST localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"organization":"Acme","email":"admin@acme.test","password":"secret123"}'
```

## The five deliverables

1. **Migration SQL** — [`server/migrations/001_init.sql`](server/migrations/001_init.sql)
2. **Chunking + embeddings** — [`server/src/ingestion/chunker.ts`](server/src/ingestion/chunker.ts),
   [`embeddings.ts`](server/src/ingestion/embeddings.ts), [`worker.ts`](server/src/ingestion/worker.ts)
3. **Hybrid search SQL** — [`server/src/retrieval/hybridSearch.ts`](server/src/retrieval/hybridSearch.ts)
4. **SSE backend + frontend hook** — [`server/src/chat/stream.ts`](server/src/chat/stream.ts),
   [`web/hooks/useChatStream.ts`](web/hooks/useChatStream.ts)
5. **`.env.example` + Docker Compose** — [`.env.example`](.env.example), [`docker-compose.yml`](docker-compose.yml)
