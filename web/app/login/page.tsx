'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [org, setOrg] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(org, email, password);
      router.replace('/chat');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div>
          <h1 className="text-lg font-semibold">DocuSphere</h1>
          <p className="text-sm text-neutral-500">
            {mode === 'login' ? 'Sign in to your workspace' : 'Create a new organization'}
          </p>
        </div>

        {mode === 'register' && (
          <input
            className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            placeholder="Organization name"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            required
          />
        )}
        <input
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          type="password"
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button
          disabled={busy}
          className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create organization'}
        </button>

        <button
          type="button"
          className="w-full text-center text-xs text-neutral-500 underline"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Need an organization? Register' : 'Have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}
