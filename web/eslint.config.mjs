import coreWebVitals from 'eslint-config-next/core-web-vitals';

/** ESLint 9 flat config (Next.js 16). */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'public/**'] },
  ...coreWebVitals,
  {
    rules: {
      // Client-side auth/bootstrap contexts legitimately set state after an
      // async fetch in an effect; keep it visible as a warning, not a build stop.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

export default config;
