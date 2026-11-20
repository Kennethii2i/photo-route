import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['specs/ui-package/{d4a,d4b,d5a}/capture-before.mjs'],
    // Capture scripts use Node globals and serialized browser callbacks.
    languageOptions: { globals: { process: 'readonly', URL: 'readonly', document: 'readonly' } },
  },
);
