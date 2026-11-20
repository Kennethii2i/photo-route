import { defineConfig } from '@playwright/test';

const browser = process.env.PHOTO_ROUTE_TEST_BROWSER;
const testPort = Number(process.env.PHOTO_ROUTE_TEST_PORT ?? 5184);
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535 || testPort === 5173) throw new Error('Invalid isolated test port');
if (browser && !['chrome', 'edge', 'firefox', 'webkit'].includes(browser)) throw new Error(`Unsupported test browser: ${browser}`);

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    browserName: browser === 'firefox' ? 'firefox' : browser === 'webkit' ? 'webkit' : 'chromium',
    channel: browser === 'edge' ? 'msedge' : browser === 'firefox' || browser === 'webkit' ? undefined : 'chrome',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
