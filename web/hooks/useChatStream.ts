'use client';

import { useCallback, useRef, useState } from 'react';
import { API_BASE, getToken, type Source } from '@/lib/api';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  status?: 'streaming' | 'done' | 'error';
  error?: string;
}

interface SseFrame {
  event: string;
  data: string;
}

/** Split a growing buffer into complete `event:/data:` frames. */
function drainFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const raw of parts) {
    if (!raw.trim() || raw.startsWith(':')) continue; // comment / heartbeat
    let event = 'message';
    let data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    frames.push({ event, data });
  }
  return { frames, rest };
}

/**
 * Streaming chat client. Uses `fetch` + `response.body.getReader()`
 * (ReadableStreamDefaultReader) rather than EventSource so we can POST a JSON
 * body and send an Authorization header.
 */
export function useChatStream() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, updater: (t: ChatTurn) => ChatTurn) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (message: string, conversationId?: string) => {
      if (isStreaming || !message.trim()) return;

      const userTurn: ChatTurn = { id: crypto.randomUUID(), role: 'user', content: message };
      const asstId = crypto.randomUUID();
      const asstTurn: ChatTurn = { id: asstId, role: 'assistant', content: '', status: 'streaming' };
      const history = turns
        .filter((t) => t.status !== 'error')
        .slice(-6)
        .map((t) => ({ role: t.role, content: t.content }));

      setTurns((prev) => [...prev, userTurn, asstTurn]);
      setIsStreaming(true);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch(`${API_BASE}/api/chat/stream`, {
          method: 'POST',
          signal: ac.signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${getToken() ?? ''}`,
            accept: 'text/event-stream',
          },
          body: JSON.stringify({ message, conversationId, history }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let newConversationId = conversationId;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const { frames, rest } = drainFrames(buffer);
          buffer = rest;

          for (const frame of frames) {
            if (frame.event === 'token') {
              const { text } = JSON.parse(frame.data) as { text: string };
              patch(asstId, (t) => ({ ...t, content: t.content + text }));
            } else if (frame.event === 'sources') {
              const sources = JSON.parse(frame.data) as Source[];
              patch(asstId, (t) => ({ ...t, sources }));
            } else if (frame.event === 'done') {
              const d = JSON.parse(frame.data) as { conversationId?: string };
              newConversationId = d.conversationId ?? newConversationId;
              patch(asstId, (t) => ({ ...t, status: 'done' }));
            } else if (frame.event === 'error') {
              const { message: m } = JSON.parse(frame.data) as { message: string };
              patch(asstId, (t) => ({ ...t, status: 'error', error: m }));
            }
          }
        }
        patch(asstId, (t) => (t.status === 'streaming' ? { ...t, status: 'done' } : t));
        return newConversationId;
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          patch(asstId, (t) => ({
            ...t,
            status: 'error',
            error: err instanceof Error ? err.message : 'stream failed',
          }));
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, turns, patch],
  );

  const reset = useCallback(() => setTurns([]), []);

  return { turns, isStreaming, send, stop, reset };
}
