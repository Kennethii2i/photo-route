import { defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: { include: ['exifr', 'exifreader', 'fflate', 'zod', 'maplibre-gl', 'heic-to/csp', '@su-engineering/heic'] },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
