import { createRequire } from 'node:module';
import type { PageText } from './chunker.js';

// pdf-parse is CJS and has a debug side-effect on `import`; require it lazily.
const require = createRequire(import.meta.url);

export interface ParsedDocument {
  pages: PageText[];
  pageCount: number;
}

/**
 * Extract text page-by-page from a PDF. pdf-parse invokes `pagerender` once per
 * page; we capture each page's text separately so chunks keep a page number.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pdfParse = require('pdf-parse') as (
    data: Buffer,
    opts?: Record<string, unknown>,
  ) => Promise<{ numpages: number }>;

  const pages: PageText[] = [];
  await pdfParse(buffer, {
    pagerender: async (pageData: {
      pageIndex?: number;
      getTextContent: (o: unknown) => Promise<{ items: Array<{ str: string; hasEOL?: boolean }> }>;
    }) => {
      const tc = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      const text = tc.items.map((i) => (i.hasEOL ? i.str + '\n' : i.str)).join(' ');
      pages.push({ page: (pageData.pageIndex ?? pages.length) + 1, text });
      return text; // pdf-parse still builds its concatenated `.text`
    },
  });

  pages.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  return { pages, pageCount: pages.length };
}

/** Markdown: treat as a single flat document (no page numbers). */
export function parseMarkdown(buffer: Buffer): ParsedDocument {
  let text = buffer.toString('utf8');
  // strip YAML front-matter
  text = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return { pages: [{ text }], pageCount: 1 };
}

export async function parseByContentType(
  contentType: string,
  filename: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  const isPdf = contentType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
  const isMd =
    /markdown|text\/plain/.test(contentType) || /\.(md|markdown|txt)$/i.test(filename);

  if (isPdf) return parsePdf(buffer);
  if (isMd) return parseMarkdown(buffer);
  throw new Error(`Unsupported content type: ${contentType} (${filename})`);
}
