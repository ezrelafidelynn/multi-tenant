import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="space-y-3 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <Link href="/" className="text-sm text-brand underline">
          Back to DocuSphere
        </Link>
      </div>
    </main>
  );
}
