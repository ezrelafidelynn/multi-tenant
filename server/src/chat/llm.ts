import OpenAI from 'openai';
import { config } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * Provider-agnostic streaming chat completion.
 * Returns the fully assembled text once the stream ends.
 */
export async function streamChat(
  messages: ChatMessage[],
  handlers: StreamHandlers,
): Promise<{ text: string; finishReason: string }> {
  switch (config.llm.provider) {
    case 'anthropic':
      return streamAnthropic(messages, handlers);
    case 'gemini':
      return streamGemini(messages, handlers);
    default:
      return streamOpenAI(messages, handlers);
  }
}

async function streamOpenAI(messages: ChatMessage[], { onToken, signal }: StreamHandlers) {
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const stream = await client.chat.completions.create(
    { model: config.llm.model, messages, stream: true, temperature: 0.2 },
    { signal },
  );
  let text = '';
  let finishReason = 'stop';
  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content ?? '';
    if (delta) {
      text += delta;
      onToken(delta);
    }
    if (part.choices[0]?.finish_reason) finishReason = part.choices[0].finish_reason;
  }
  return { text, finishReason };
}

/** Anthropic Messages API via raw fetch (no SDK dependency required). */
async function streamAnthropic(messages: ChatMessage[], { onToken, signal }: StreamHandlers) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.llm.model,
      max_tokens: 1024,
      temperature: 0.2,
      system,
      stream: true,
      messages: rest,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`anthropic ${res.status}: ${await res.text()}`);

  let text = '';
  for await (const evt of parseSse(res.body)) {
    if (evt.event === 'content_block_delta') {
      const delta = JSON.parse(evt.data).delta?.text ?? '';
      if (delta) {
        text += delta;
        onToken(delta);
      }
    }
  }
  return { text, finishReason: 'stop' };
}

/** Gemini 1.5 streamGenerateContent via raw fetch. */
async function streamGemini(messages: ChatMessage[], { onToken, signal }: StreamHandlers) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${config.llm.model}:streamGenerateContent` +
    `?alt=sse&key=${config.geminiApiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`gemini ${res.status}: ${await res.text()}`);

  let text = '';
  for await (const evt of parseSse(res.body)) {
    const parts = JSON.parse(evt.data)?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (p.text) {
        text += p.text;
        onToken(p.text);
      }
    }
  }
  return { text, finishReason: 'stop' };
}

/** Minimal SSE parser over a web ReadableStream. */
async function* parseSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data && data !== '[DONE]') yield { event, data };
    }
  }
}
