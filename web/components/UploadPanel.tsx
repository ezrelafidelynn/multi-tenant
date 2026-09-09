'use client';

import { useEffect, useRef, useState } from 'react';
import { api, API_BASE, getToken, type DocumentRow } from '@/lib/api';

export function UploadPanel() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      const { documents } = await api<{ documents: DocumentRow[] }>('/api/documents');
      setDocs(documents);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load');
    }
  };

  useEffect(() => {
    refresh();
    const anyPending = () => docs.some((d) => d.status === 'pending' || d.status === 'processing');
    const t = setInterval(() => {
      if (anyPending()) refresh();
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUpload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', file.name);
      const res = await fetch(`${API_BASE}/api/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.md,.markdown,.txt"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-white"
        />
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto text-xs">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-2 py-1.5 dark:border-neutral-800"
          >
            <span className="truncate" title={d.filename}>
              {d.title}
            </span>
            <StatusBadge doc={d} />
          </li>
        ))}
        {docs.length === 0 && <li className="text-neutral-500">No documents yet.</li>}
      </ul>
    </div>
  );
}

function StatusBadge({ doc }: { doc: DocumentRow }) {
  const map: Record<DocumentRow['status'], string> = {
    pending: 'bg-neutral-200 text-neutral-700',
    processing: 'bg-amber-200 text-amber-800',
    ready: 'bg-emerald-200 text-emerald-800',
    failed: 'bg-red-200 text-red-800',
  };
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 ${map[doc.status]}`} title={doc.error ?? ''}>
      {doc.status}
      {doc.status === 'ready' && ` · ${doc.chunk_count} chunks`}
    </span>
  );
}
