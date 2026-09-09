'use client';

import { Fragment, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import type { Source } from '@/lib/api';

/**
 * Renders the assistant message as Markdown (with syntax-highlighted code via
 * rehype-highlight / highlight.js), then turns inline `[n]` citation markers
 * into buttons that open the preview drawer.
 */
export function AnswerBody({
  content,
  sources,
  onCite,
}: {
  content: string;
  sources?: Source[];
  onCite: (s: Source) => void;
}) {
  const byMarker = new Map((sources ?? []).map((s) => [s.marker, s]));

  const linkifyCitations = (children: ReactNode): ReactNode => {
    if (typeof children === 'string') {
      return children.split(/(\[\d+\])/g).map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        const src = m ? byMarker.get(Number(m[1])) : undefined;
        if (!m || !src) return <Fragment key={i}>{part}</Fragment>;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCite(src)}
            className="mx-0.5 inline-flex items-center rounded bg-brand/10 px-1 text-xs font-medium text-brand hover:bg-brand/20"
            title={`${src.documentTitle}${src.page != null ? ` · p.${src.page}` : ''}`}
          >
            {m[1]}
          </button>
        );
      });
    }
    if (Array.isArray(children)) {
      return children.map((c, i) => <Fragment key={i}>{linkifyCitations(c)}</Fragment>);
    }
    return children;
  };

  return (
    <div className="markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          p: ({ children }) => <p>{linkifyCitations(children)}</p>,
          li: ({ children }) => <li>{linkifyCitations(children)}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline">
              {children}
            </a>
          ),
        }}
      >
        {content || '…'}
      </ReactMarkdown>

      {sources && sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-200 pt-2 dark:border-neutral-800">
          {sources.map((s) => (
            <button
              key={s.chunkId}
              type="button"
              onClick={() => onCite(s)}
              className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:border-brand hover:text-brand dark:border-neutral-700 dark:text-neutral-300"
            >
              [{s.marker}] {s.documentTitle}
              {s.page != null && ` · p.${s.page}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
