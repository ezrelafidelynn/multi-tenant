-- ════════════════════════════════════════════════════════════════════════════
-- DocuSphere — initial schema
-- Multi-tenant hybrid retrieval: pgvector (HNSW) + full-text search (GIN tsvector)
-- Target: PostgreSQL 16 with the pgvector extension (image: pgvector/pgvector:pg16)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ---- Extensions ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;      -- dense vector type + HNSW/IVFFlat
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- optional fuzzy title search

-- ---- Enums -------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role      AS ENUM ('admin', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE document_status AS ENUM ('pending', 'processing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Tenancy ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    slug        text        NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email            citext     NOT NULL,
    password_hash    text       NOT NULL,
    role             user_role  NOT NULL DEFAULT 'member',
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);

-- ---- Documents ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    uploaded_by      uuid            REFERENCES users(id) ON DELETE SET NULL,
    title            text            NOT NULL,
    filename         text            NOT NULL,
    content_type     text            NOT NULL,          -- application/pdf | text/markdown
    byte_size        bigint          NOT NULL,
    storage_key      text            NOT NULL,          -- object key in S3/MinIO
    checksum_sha256  text,
    status           document_status NOT NULL DEFAULT 'pending',
    error            text,
    page_count       integer,
    chunk_count      integer         NOT NULL DEFAULT 0,
    created_at       timestamptz     NOT NULL DEFAULT now(),
    updated_at       timestamptz     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_org_created
    ON documents(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_org_status
    ON documents(organization_id, status);

-- ---- Chunks ----------------------------------------------------------------------
-- One row per semantic chunk. `embedding` dim MUST equal EMBEDDING_DIM (.env).
-- `tsv_content` is a generated column so lexical index stays consistent with text.
CREATE TABLE IF NOT EXISTS document_chunks (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    document_id      uuid        NOT NULL REFERENCES documents(id)     ON DELETE CASCADE,
    chunk_index      integer     NOT NULL,
    content          text        NOT NULL,
    token_count      integer     NOT NULL,
    page_number      integer,                       -- 1-based; NULL for markdown
    section_path     text,                          -- e.g. "Introduction > Scope"
    embedding        vector(1536),
    tsv_content      tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, chunk_index)
);

-- ---- Indexes for hybrid retrieval ------------------------------------------------
-- Dense branch: HNSW on cosine distance operator (<=>).
--   m               = graph out-degree (higher -> better recall, more memory)
--   ef_construction = build-time candidate list (higher -> better graph, slower build)
-- Query-time recall is tuned with:  SET hnsw.ef_search = <n>;   (see hybridSearch.ts)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
    ON document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Lexical branch: GIN over the generated tsvector.
CREATE INDEX IF NOT EXISTS idx_chunks_tsv
    ON document_chunks
    USING gin (tsv_content);

-- Tenant filter + join helpers. The composite (organization_id, document_id)
-- lets the planner pre-filter by tenant before the ANN / GIN scan.
CREATE INDEX IF NOT EXISTS idx_chunks_org           ON document_chunks(organization_id);
CREATE INDEX IF NOT EXISTS idx_chunks_org_document  ON document_chunks(organization_id, document_id);

-- ---- Chat history (optional, supports the streaming endpoint) -------------------
CREATE TABLE IF NOT EXISTS conversations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          uuid        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    title            text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_org_user
    ON conversations(organization_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role             text        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content          text        NOT NULL,
    citations        jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at);

-- ---- updated_at trigger --------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security — defense in depth on top of the app's WHERE organization_id
-- The API runs:  SET LOCAL app.current_org = '<uuid>';  per request/transaction
-- (see server/src/db.ts -> withTenant()). Policies are FORCED so even the table
-- owner is constrained; use a separate superuser/migration role for DDL.
-- ════════════════════════════════════════════════════════════════════════════
-- NOTE: `organizations` and `users` are deliberately NOT under RLS — they are
-- read before a tenant context exists (login / registration). They are guarded
-- by application logic and unique constraints instead. RLS is applied only to
-- the per-tenant content tables below.
ALTER TABLE documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents       FORCE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations   FORCE ROW LEVEL SECURITY;
ALTER TABLE messages        FORCE ROW LEVEL SECURITY;

-- current_setting(..., true) => NULL instead of error when unset; NULL fails the
-- comparison so "no tenant context" means "no rows".
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_org', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents','document_chunks','conversations','messages']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  END LOOP;
END $$;

CREATE POLICY tenant_isolation ON documents
    USING (organization_id = current_org_id())
    WITH CHECK (organization_id = current_org_id());
CREATE POLICY tenant_isolation ON document_chunks
    USING (organization_id = current_org_id())
    WITH CHECK (organization_id = current_org_id());
CREATE POLICY tenant_isolation ON conversations
    USING (organization_id = current_org_id())
    WITH CHECK (organization_id = current_org_id());
CREATE POLICY tenant_isolation ON messages
    USING (organization_id = current_org_id())
    WITH CHECK (organization_id = current_org_id());

-- The role the app connects as. RLS is enforced for non-superusers; make sure
-- this role is NOT superuser and does NOT own the tables (BYPASSRLS off).
-- Example provisioning (run once as a superuser, outside this migration):
--   CREATE ROLE docusphere LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO docusphere;

COMMIT;

-- ---- Notes -------------------------------------------------------------------
-- • Scaling tenants: for very large deployments, LIST-partition document_chunks
--   by organization_id (or hash) and build per-partition HNSW indexes so the ANN
--   graph never mixes tenants. The queries in this repo already filter by
--   organization_id, so partition pruning is transparent.
-- • Re-embedding: if EMBEDDING_MODEL / EMBEDDING_DIM changes, alter the column
--   type (vector(N)) and rebuild idx_chunks_embedding_hnsw.
