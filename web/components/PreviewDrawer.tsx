'use client';

import { useEffect } from 'react';
import type { Source } from '@/lib/api';

export function PreviewDrawer({
  source,
  onClose,
}: {
  source: Source | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!source) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand">
              Source [{source.marker}]
            </p>
            <h2 className="mt-1 font-semibold">{source.documentTitle}</h2>
            <p className="text-xs text-neutral-500">
              {source.filename}
              {source.page != null && ` · page ${source.page}`} · score{' '}
              {source.score.toFixed(4)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <blockquote className="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed dark:border-neutral-800 dark:bg-neutral-950">
          {source.snippet}
        </blockquote>
      </aside>
    </div>
  );
}
