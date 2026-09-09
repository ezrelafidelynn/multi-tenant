'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1>Application error</h1>
          <button onClick={reset} style={{ marginTop: 12 }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
