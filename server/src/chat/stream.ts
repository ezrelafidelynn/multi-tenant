import type { Request, Response } from 'express';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { runHybridSearch } from '../retrieval/hybridSearch.js';
import { streamChat, type ChatMessage } from './llm.js';
import { buildCitations, buildMessages } from './prompt.js';

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .optional(),
});

/**
 * POST /api/chat/stream   (Server-Sent Events)
 *
 * Event sequence:
 *   event: status   data: {"stage":"retrieving"}
 *   event: sources  data: [ {marker, documentTitle, filename, page, snippet, score}, … ]
 *   event: token    data: {"text":"…"}          (repeated)
 *   event: done     data: {"finishReason":"stop","conversationId":"…"}
 *   event: error    data: {"message":"…"}
 */
export async function chatStreamController(req: Request, res: Response) {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { message, history, conversationId } = parsed.data;
  const { organizationId, userId } = req.auth!;

  // ---- SSE handshake ----
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

  // abort the upstream LLM call if the browser disconnects
  const ac = new AbortController();
  req.on('close', () => ac.abort());

  try {
    send('status', { stage: 'retrieving' });
    const chunks = await runHybridSearch(organizationId, message);
    const citations = buildCitations(chunks);
    send('sources', citations);

    send('status', { stage: 'generating' });
    const messages: ChatMessage[] = buildMessages(
      message,
      citations,
      (history ?? []) as ChatMessage[],
    );

    const { text, finishReason } = await streamChat(messages, {
      signal: ac.signal,
      onToken: (t) => send('token', { text: t }),
    });

    const convId = await persist(organizationId, userId, conversationId, message, text, citations);
    send('done', { finishReason, conversationId: convId });
  } catch (err) {
    if (!ac.signal.aborted) {
      send('error', { message: err instanceof Error ? err.message : 'stream failed' });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

async function persist(
  organizationId: string,
  userId: string,
  conversationId: string | undefined,
  question: string,
  answer: string,
  citations: unknown,
): Promise<string> {
  return withTenant(organizationId, async (tx) => {
    let convId = conversationId;
    if (convId) {
      const owned = await tx.query(
        'SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2',
        [convId, userId],
      );
      if (owned.rowCount === 0) convId = undefined;
    }
    if (!convId) {
      const c = await tx.query(
        `INSERT INTO conversations (organization_id, user_id, title)
         VALUES ($1, $2, $3) RETURNING id`,
        [organizationId, userId, question.slice(0, 80)],
      );
      convId = c.rows[0].id as string;
    }
    await tx.query(
      `INSERT INTO messages (conversation_id, organization_id, role, content)
       VALUES ($1, $2, 'user', $3)`,
      [convId, organizationId, question],
    );
    await tx.query(
      `INSERT INTO messages (conversation_id, organization_id, role, content, citations)
       VALUES ($1, $2, 'assistant', $3, $4::jsonb)`,
      [convId, organizationId, answer, JSON.stringify(citations)],
    );
    return convId;
  });
}
