import type { RetrievedChunk } from '../retrieval/hybridSearch.js';
import type { ChatMessage } from './llm.js';

export interface Citation {
  marker: number; // [1], [2], ...
  chunkId: string;
  documentId: string;
  documentTitle: string;
  filename: string;
  page: number | null;
  snippet: string;
  score: number;
}

export function buildCitations(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((c, i) => ({
    marker: i + 1,
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    filename: c.filename,
    page: c.page,
    snippet: c.content.length > 480 ? c.content.slice(0, 480) + '…' : c.content,
    score: c.score,
  }));
}

const SYSTEM_PROMPT = `You are DocuSphere, an enterprise document assistant.
Answer ONLY from the provided context passages. If the answer is not in the
context, say you don't have that information — do not use outside knowledge.
Cite every claim with bracketed markers matching the passage numbers, e.g. [1] or [2][4].
Be concise and use Markdown.`;

export function buildMessages(
  question: string,
  citations: Citation[],
  history: ChatMessage[] = [],
): ChatMessage[] {
  const context = citations
    .map(
      (c) =>
        `[${c.marker}] (source: "${c.documentTitle}"${c.page ? `, p.${c.page}` : ''})\n${c.snippet}`,
    )
    .join('\n\n---\n\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-6),
    {
      role: 'user',
      content: `Context passages:\n\n${context || '(no relevant passages found)'}\n\nQuestion: ${question}`,
    },
  ];
}
