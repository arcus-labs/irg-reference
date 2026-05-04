import { existsSync } from 'fs';
import path from 'path';
import { loadEnvConfig } from '@next/env';

function hasRequiredEnv(requiredEnvNames: string[]): boolean {
  return requiredEnvNames.every((name) => Boolean(process.env[name]));
}

function hasEnvFile(root: string): boolean {
  return ['.env.local', '.env'].some((name) => existsSync(path.join(root, name)));
}

function candidateRoots(baseDir: string): string[] {
  const resolved = path.resolve(baseDir);
  return [path.resolve(resolved, '..'), resolved].filter(
    (value, index, values) => values.indexOf(value) === index
  );
}

export function loadServerEnv(
  baseDir = process.cwd(),
  requiredEnvNames: string[] = ['IRG_ENDPOINT']
): string | null {
  for (const root of candidateRoots(baseDir)) {
    if (!hasEnvFile(root)) continue;

    loadEnvConfig(root, undefined, console, true);
    if (hasRequiredEnv(requiredEnvNames)) {
      return root;
    }
  }

  return null;
}

export function getRequiredServerEnv(name: string, baseDir = process.cwd()): string {
  if (!process.env[name]) {
    loadServerEnv(baseDir, [name]);
  }

  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }

  return value;
}