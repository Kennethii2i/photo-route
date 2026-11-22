import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { assertNoPublicCredentials } from './tools/public-env-policy.ts';

export default defineConfig(({ mode }) => {
  // Read only in Node; do not return credentials through define or client config.
  assertNoPublicCredentials(loadEnv(mode, process.cwd(), ''));
  return {
    optimizeDeps: { include: ['exifr', 'exifreader', 'fflate', 'zod', 'maplibre-gl', 'heic-to/csp', '@su-engineering/heic'] },
    test: {
      include: ['tests/unit/**/*.test.ts'],
    },
  };
});
