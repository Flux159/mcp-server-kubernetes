import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { serverConfig } from '../src/config/server-config.js';

describe('serverConfig', () => {
  it('reports the package version in server metadata', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string };

    expect(serverConfig.version).toBe(pkg.version);
  });
});
