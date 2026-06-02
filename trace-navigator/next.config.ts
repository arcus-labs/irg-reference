import path from 'path';
import type { NextConfig } from 'next';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd(), '..'));

const nextConfig: NextConfig = {
  // The dossier generator now lives in the sibling shared/ directory (imported
  // via @shared/*). Point file tracing at the repo root so that out-of-app
  // import bundles correctly.
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
};

export default nextConfig;
