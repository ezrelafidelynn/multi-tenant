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
| `web/`          | Next.js 16 App Router chat UI, streaming reader hook               |
| `docker-compose.yml` | Postgres (`pgvector/pgvector:pg16`), Redis, MinIO + opt-in app services |

## Quick start (local dev)

```bash
cp .env.example .env                  # fill in OPENAI_API_KEY at minimum
cp web/.env.local.example web/.env.local
docker compose up -d                  # postgres + redis + minio
npm install                           # installs both workspaces (root)
npm run migrate                       # applies server/migrations/*.sql
npm run dev:server                    # API on :4000
npm run dev:worker                    # ingestion worker (separate terminal)
npm run dev:web                       # UI on :3000
```

## Run everything in containers

```bash
cp .env.example .env
docker compose --profile app up --build   # + api, worker, web (:3000)
docker compose --profile app run --rm api node dist/scripts/migrate.js
```

## Checks

```bash
npm run typecheck        # server (tsc) + web (tsc)
npm run lint --workspace web
npm run build --workspace web    # Next.js standalone production build
npm run build --workspace server
```

`npm audit` is clean (0 vulnerabilities) as of the last dependency refresh; `qs`
and `postcss` are pinned via root `overrides`.

Register an organization + admin user:

```bash
curl -X POST localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"organization":"Acme","email":"admin@acme.test","password":"secret123"}'
```

## Production notes

- **Security headers**: `web/next.config.mjs` sets CSP, HSTS, `X-Frame-Options: DENY`,
  `nosniff`, and a locked-down `Permissions-Policy`. `connect-src` is limited to
  `self` + `NEXT_PUBLIC_API_BASE`.
- **Auth token storage**: the SPA keeps its JWT in `localStorage` for simplicity.
  For a hardened deployment, move to an `httpOnly` + `Secure` + `SameSite` cookie
  and add CSRF protection on the API.
- **RLS**: run the API as a non-superuser Postgres role (`NOSUPERUSER NOBYPASSRLS`)
  so the row-level tenant policies are actually enforced (see `001_init.sql`).
- **Build output**: `web` builds to a Next.js **standalone** bundle; the image
  runs as a non-root user.
- Run `npm run typecheck`, `npm run lint --workspace web`, and the workspace
  builds in CI. Current `npm audit`: 0 vulnerabilities.

## The five deliverables

1. **Migration SQL** — [`server/migrations/001_init.sql`](server/migrations/001_init.sql)
2. **Chunking + embeddings** — [`server/src/ingestion/chunker.ts`](server/src/ingestion/chunker.ts),
   [`embeddings.ts`](server/src/ingestion/embeddings.ts), [`worker.ts`](server/src/ingestion/worker.ts)
3. **Hybrid search SQL** — [`server/src/retrieval/hybridSearch.ts`](server/src/retrieval/hybridSearch.ts)
4. **SSE backend + frontend hook** — [`server/src/chat/stream.ts`](server/src/chat/stream.ts),
   [`web/hooks/useChatStream.ts`](web/hooks/useChatStream.ts)
5. **`.env.example` + Docker Compose** — [`.env.example`](.env.example), [`docker-compose.yml`](docker-compose.yml)
