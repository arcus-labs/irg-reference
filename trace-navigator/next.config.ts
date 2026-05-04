import path from 'path';
import type { NextConfig } from 'next';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd(), '..'));

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
