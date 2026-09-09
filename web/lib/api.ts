export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

const TOKEN_KEY = 'docusphere.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error?.formErrors?.join?.(', ') || detail.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface DocumentRow {
  id: string;
  title: string;
  filename: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error: string | null;
  page_count: number | null;
  chunk_count: number;
  created_at: string;
}

export interface Source {
  marker: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  filename: string;
  page: number | null;
  snippet: string;
  score: number;
}
