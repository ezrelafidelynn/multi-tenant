import { encode, decode } from 'gpt-tokenizer';
import { config } from '../config.js';

export interface PageText {
  /** 1-based page number for PDFs; undefined for flat markdown. */
  page?: number;
  text: string;
}

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
  page?: number;
  sectionPath?: string;
}

const NBSP = / /g;
const ZERO_WIDTH = /[​-‍﻿]/g;
const HORIZONTAL_WS = /[^\S\n]+/g;

/** Collapse whitespace, drop control/zero-width chars, keep paragraph breaks. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(NBSP, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(HORIZONTAL_WS, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Token-aware splitter: ~`CHUNK_TOKENS` per chunk with `CHUNK_OVERLAP` tokens of
 * carry-over. Prefers to break on paragraph, then sentence, then hard token
 * boundaries so a chunk rarely splits mid-sentence.
 *
 * Page numbers are preserved by chunking each page independently — a chunk never
 * straddles two pages, so every citation resolves to exactly one page.
 */
export function chunkPages(
  pages: PageText[],
  opts: { tokens?: number; overlap?: number } = {},
): Chunk[] {
  const target = opts.tokens ?? config.chunking.tokens;
  const overlap = Math.min(opts.overlap ?? config.chunking.overlap, target - 1);

  const chunks: Chunk[] = [];
  let index = 0;

  for (const { page, text } of pages) {
    const cleaned = cleanText(text);
    if (!cleaned) continue;

    // Split into paragraphs; further split any paragraph that alone exceeds target.
    const atoms: string[] = [];
    for (const para of cleaned.split(/\n{2,}/)) {
      if (countTokens(para) <= target) atoms.push(para);
      else atoms.push(...splitSentences(para));
    }

    let buf: number[] = [];
    const flush = () => {
      if (!buf.length) return;
      const content = decode(buf).trim();
      if (content) chunks.push({ index: index++, content, tokenCount: buf.length, page });
      buf = overlap > 0 ? buf.slice(-overlap) : []; // carry tail into next chunk
    };

    for (const atom of atoms) {
      const atomTokens = encode(' ' + atom.trim());
      if (buf.length && buf.length + atomTokens.length > target) flush();

      if (atomTokens.length > target) {
        // still too big (giant table/line) -> hard slice with overlap
        for (let i = 0; i < atomTokens.length; i += target - overlap) {
          const slice = atomTokens.slice(i, i + target);
          const content = decode(slice).trim();
          if (content) chunks.push({ index: index++, content, tokenCount: slice.length, page });
        }
        buf = [];
      } else {
        buf.push(...atomTokens);
      }
    }
    flush();
  }

  return chunks;
}

export function countTokens(text: string): number {
  return encode(text).length;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=["'([]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
