import fs from 'fs';
import os from 'os';
import path from 'path';
import { getRequiredServerEnv, loadServerEnv } from './server-env';

describe('server env loading', () => {
  const originalIrgEndpoint = process.env.IRG_ENDPOINT;

  afterEach(() => {
    if (originalIrgEndpoint === undefined) {
      delete process.env.IRG_ENDPOINT;
    } else {
      process.env.IRG_ENDPOINT = originalIrgEndpoint;
    }
  });

  test('loads IRG_ENDPOINT from the repo-root .env when called from trace-navigator', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-nav-env-'));
    const traceNavigatorRoot = path.join(tempRoot, 'trace-navigator');
    fs.mkdirSync(traceNavigatorRoot, { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, '.env'),
      'IRG_ENDPOINT=http://localhost:2100/webhook/irg-process\n'
    );

    delete process.env.IRG_ENDPOINT;

    try {
      expect(loadServerEnv(traceNavigatorRoot)).toBe(tempRoot);
      expect(getRequiredServerEnv('IRG_ENDPOINT', traceNavigatorRoot)).toBe(
        'http://localhost:2100/webhook/irg-process'
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('preserves an already-set IRG_ENDPOINT', () => {
    process.env.IRG_ENDPOINT = 'http://override.example/webhook/irg-process';

    expect(getRequiredServerEnv('IRG_ENDPOINT')).toBe(
      'http://override.example/webhook/irg-process'
    );
  });
});