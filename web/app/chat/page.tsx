'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useChatStream } from '@/hooks/useChatStream';
import { AnswerBody } from '@/components/AnswerBody';
import { PreviewDrawer } from '@/components/PreviewDrawer';
import { UploadPanel } from '@/components/UploadPanel';
import type { Source } from '@/lib/api';

export default function ChatPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const { turns, isStreaming, send, stop } = useChatStream();
  const [input, setInput] = useState('');
  const [drawer, setDrawer] = useState<Source | null>(null);
  const convRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  if (loading || !user) {
    return <main className="grid min-h-screen place-items-center text-sm text-neutral-500">…</main>;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || isStreaming) return;
    setInput('');
    const conv = await send(q, convRef.current);
    if (conv) convRef.current = conv;
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col gap-4 border-r border-neutral-200 p-4 dark:border-neutral-800 md:flex">
        <div>
          <h1 className="font-semibold">DocuSphere</h1>
          <p className="truncate text-xs text-neutral-500">
            {user.email} · {user.role}
          </p>
        </div>
        <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Documents</h2>
        <UploadPanel />
        <button onClick={logout} className="text-left text-xs text-neutral-500 underline">
          Sign out
        </button>
      </aside>

      {/* Chat column */}
      <main className="flex flex-1 flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-8">
          {turns.length === 0 && (
            <p className="mx-auto max-w-2xl pt-16 text-center text-sm text-neutral-500">
              Ask a question about your organization&apos;s documents. Answers are grounded in
              hybrid (lexical + vector) retrieval and cite their sources.
            </p>
          )}

          {turns.map((t) => (
            <div key={t.id} className="mx-auto max-w-2xl">
              {t.role === 'user' ? (
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-brand px-4 py-2 text-sm text-white">
                  {t.content}
                </div>
              ) : (
                <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  {t.status === 'error' ? (
                    <p className="text-sm text-red-600">Error: {t.error}</p>
                  ) : (
                    <AnswerBody content={t.content} sources={t.sources} onCite={setDrawer} />
                  )}
                  {t.status === 'streaming' && (
                    <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-brand align-middle" />
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={onSubmit}
          className="border-t border-neutral-200 p-4 dark:border-neutral-800"
        >
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e);
                }
              }}
              rows={1}
              placeholder="Ask about your documents…"
              className="max-h-40 flex-1 resize-none rounded-xl border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-xl border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Send
              </button>
            )}
          </div>
        </form>
      </main>

      <PreviewDrawer source={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
