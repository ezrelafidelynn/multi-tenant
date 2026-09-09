import pgvector from 'pgvector/pg';
import { withTenant } from '../db.js';
import { config } from '../config.js';
import { embedQuery } from '../ingestion/embeddings.js';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  filename: string;
  chunkIndex: number;
  page: number | null;
  content: string;
  vectorRank: number | null;
  lexicalRank: number | null;
  vectorScore: number;
  lexicalScore: number;
  score: number; // fused
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  HYBRID SEARCH  (Reciprocal Rank Fusion)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Dense branch  : ORDER BY embedding <=> $query_embedding   (cosine distance)
 *  Lexical branch: ts_rank_cd(tsv_content, websearch_to_tsquery(...))  DESC
 *  Fusion        : score(d) = Σ 1 / (rrf_k + rank_i(d))   over branches it appears in
 *
 *  Every branch is filtered by organization_id BEFORE ranking, so ANN/GIN scans
 *  never cross tenants. RLS (SET LOCAL app.current_org, via withTenant) is the
 *  backstop if the WHERE clause is ever dropped.
 *
 *  `SET LOCAL hnsw.ef_search` is applied in withTenant() to trade recall/latency.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const HYBRID_SQL = /* sql */ `
WITH params AS (
  SELECT
    $1::uuid    AS org_id,
    $2::vector  AS query_embedding,
    $3::text    AS query_text,
    $4::int     AS candidates,
    $5::int     AS rrf_k,
    $6::int     AS top_k
),
vector_hits AS (
  SELECT c.id,
         ROW_NUMBER() OVER (ORDER BY c.embedding <=> p.query_embedding) AS rank,
         1 - (c.embedding <=> p.query_embedding)                        AS cosine_sim
  FROM document_chunks c
  CROSS JOIN params p
  WHERE c.organization_id = p.org_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p.query_embedding
  LIMIT (SELECT candidates FROM params)
),
lexical_hits AS (
  SELECT c.id,
         ROW_NUMBER() OVER (
           ORDER BY ts_rank_cd(c.tsv_content, websearch_to_tsquery('english', p.query_text)) DESC
         ) AS rank,
         ts_rank_cd(c.tsv_content, websearch_to_tsquery('english', p.query_text)) AS bm25
  FROM document_chunks c
  CROSS JOIN params p
  WHERE c.organization_id = p.org_id
    AND p.query_text <> ''
    AND c.tsv_content @@ websearch_to_tsquery('english', p.query_text)
  ORDER BY bm25 DESC
  LIMIT (SELECT candidates FROM params)
),
candidate_ids AS (
  SELECT id FROM vector_hits
  UNION
  SELECT id FROM lexical_hits
),
fused AS (
  SELECT
    ci.id,
    v.rank                                              AS vector_rank,
    l.rank                                              AS lexical_rank,
    COALESCE(v.cosine_sim, 0)                           AS vector_score,
    COALESCE(l.bm25, 0)                                 AS lexical_score,
    COALESCE(1.0 / ((SELECT rrf_k FROM params) + v.rank), 0)
      + COALESCE(1.0 / ((SELECT rrf_k FROM params) + l.rank), 0) AS rrf_score
  FROM candidate_ids ci
  LEFT JOIN vector_hits  v ON v.id = ci.id
  LEFT JOIN lexical_hits l ON l.id = ci.id
)
SELECT
  c.id                       AS chunk_id,
  c.document_id,
  d.title                    AS document_title,
  d.filename,
  c.chunk_index,
  c.page_number,
  c.content,
  f.vector_rank,
  f.lexical_rank,
  f.vector_score,
  f.lexical_score,
  f.rrf_score               AS score
FROM fused f
JOIN document_chunks c ON c.id = f.id
JOIN documents        d ON d.id = c.document_id
WHERE d.status = 'ready'
ORDER BY f.rrf_score DESC, f.vector_rank NULLS LAST
LIMIT (SELECT top_k FROM params);
`;

/**
 * Alternative fusion: normalized linear combination.
 * final = alpha * norm(cosine_sim) + (1 - alpha) * norm(bm25)
 * (kept here for reference; swap into runHybridSearch if you prefer it over RRF)
 */
export const LINEAR_FUSION_SQL = /* sql */ `
WITH params AS (
  SELECT $1::uuid AS org_id, $2::vector AS qe, $3::text AS qt,
         $4::int AS candidates, $5::float AS alpha, $6::int AS top_k
),
v AS (
  SELECT c.id, 1 - (c.embedding <=> p.qe) AS s
  FROM document_chunks c CROSS JOIN params p
  WHERE c.organization_id = p.org_id AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p.qe LIMIT (SELECT candidates FROM params)
),
l AS (
  SELECT c.id, ts_rank_cd(c.tsv_content, websearch_to_tsquery('english', p.qt)) AS s
  FROM document_chunks c CROSS JOIN params p
  WHERE c.organization_id = p.org_id
    AND c.tsv_content @@ websearch_to_tsquery('english', p.qt)
  ORDER BY s DESC LIMIT (SELECT candidates FROM params)
),
vn AS (SELECT id, (s - min(s) OVER ()) / NULLIF(max(s) OVER () - min(s) OVER (), 0) AS n FROM v),
ln AS (SELECT id, (s - min(s) OVER ()) / NULLIF(max(s) OVER () - min(s) OVER (), 0) AS n FROM l),
ids AS (SELECT id FROM vn UNION SELECT id FROM ln)
SELECT c.id AS chunk_id, c.document_id, d.title AS document_title, d.filename,
       c.chunk_index, c.page_number, c.content,
       NULL::int AS vector_rank, NULL::int AS lexical_rank,
       COALESCE(vn.n,0) AS vector_score, COALESCE(ln.n,0) AS lexical_score,
       (SELECT alpha FROM params) * COALESCE(vn.n, 0)
         + (1 - (SELECT alpha FROM params)) * COALESCE(ln.n, 0) AS score
FROM ids i
JOIN document_chunks c ON c.id = i.id
JOIN documents d ON d.id = c.document_id
LEFT JOIN vn ON vn.id = i.id
LEFT JOIN ln ON ln.id = i.id
WHERE d.status = 'ready'
ORDER BY score DESC
LIMIT (SELECT top_k FROM params);
`;

export interface HybridSearchOptions {
  topK?: number;
  candidates?: number;
  rrfK?: number;
}

export async function runHybridSearch(
  organizationId: string,
  queryText: string,
  opts: HybridSearchOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? config.retrieval.topK;
  const candidates = opts.candidates ?? config.retrieval.candidates;
  const rrfK = opts.rrfK ?? config.retrieval.rrfK;

  const queryEmbedding = await embedQuery(queryText);

  const rows = await withTenant(organizationId, async (tx) => {
    const res = await tx.query(HYBRID_SQL, [
      organizationId,
      pgvector.toSql(queryEmbedding),
      queryText.trim(),
      candidates,
      rrfK,
      topK,
    ]);
    return res.rows as Array<Record<string, unknown>>;
  });

  return rows.map((r) => ({
    chunkId: r.chunk_id as string,
    documentId: r.document_id as string,
    documentTitle: r.document_title as string,
    filename: r.filename as string,
    chunkIndex: r.chunk_index as number,
    page: (r.page_number as number | null) ?? null,
    content: r.content as string,
    vectorRank: (r.vector_rank as number | null) ?? null,
    lexicalRank: (r.lexical_rank as number | null) ?? null,
    vectorScore: Number(r.vector_score ?? 0),
    lexicalScore: Number(r.lexical_score ?? 0),
    score: Number(r.score ?? 0),
  }));
}
