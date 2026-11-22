import { describe, expect, it } from 'vitest';
import { loadEnv } from 'vite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoPublicCredentials } from '../../tools/public-env-policy';

const syntheticValue = ['AAPT', 'synthetic'.repeat(8), '.AT2_', 'synthetic'].join('');

describe('public environment credential protection', () => {
  it('rejects credential names even when the token format is unknown, without echoing values', () => {
    const unknownValue = 'synthetic-unknown-format'.repeat(3);
    for (const name of ['VITE_ARCGIS_API_KEY', 'VITE_ESRI_TOKEN', 'VITE_API_KEY', 'VITE_CLIENT_SECRET', 'VITE_PASSWORD']) {
      let message = '';
      try { assertNoPublicCredentials({ [name]: unknownValue }); }
      catch (error) { message = (error as Error).message; }
      expect(message).toContain('must not use VITE_');
      expect(message).not.toContain(unknownValue);
    }
  });

  it('rejects Esri tokens hidden in otherwise harmless public variable names', () => {
    expect(() => assertNoPublicCredentials({ VITE_MAP_LABEL: syntheticValue })).toThrow('server-side');
    expect(() => assertNoPublicCredentials({ VITE_MAP_URL: `https://example.invalid/?token=${syntheticValue}` })).toThrow('server-side');
  });

  it('permits non-public server variables, ordinary client values, and empty placeholders', () => {
    expect(() => assertNoPublicCredentials({ ARCGIS_API_KEY: syntheticValue, VITE_APP_TITLE: 'Photo Route', VITE_ESRI_TOKEN: ' ' })).not.toThrow();
  });

  it('checks values loaded from an ignored local file, including variable expansion', () => {
    const directory = mkdtempSync(join(tmpdir(), 'photo-route-env-policy-'));
    try {
      writeFileSync(join(directory, '.env.local'), `ARCGIS_API_KEY=${syntheticValue}\nVITE_MAP_LABEL=\${ARCGIS_API_KEY}\n`);
      expect(() => assertNoPublicCredentials(loadEnv('production', directory, ''))).toThrow('server-side');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
