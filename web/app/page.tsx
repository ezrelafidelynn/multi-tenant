'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/chat' : '/login');
  }, [user, loading, router]);

  return (
    <main className="grid min-h-screen place-items-center text-sm text-neutral-500">
      Loading DocuSphere…
    </main>
  );
}
