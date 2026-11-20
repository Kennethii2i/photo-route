import { expect, test } from '@playwright/test';

test('P0-T05 browser Web Crypto hashes bounded synthetic bytes locally', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { hashQueue } = await import('../../spikes/p0-t05/hash-queue');
    const memory = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const before = memory();
    const bytes = new Uint8Array(16 * 1024 * 1024);
    bytes.fill(42);
    const started = performance.now();
    const progress: number[] = [];
    const values = await hashQueue([{ name: 'synthetic.bin', bytes: new Blob([bytes]) }], {
      concurrency: 1,
      maxBytes: 16 * 1024 * 1024,
      onProgress: value => progress.push(value.completed),
    });
    return { elapsedMs: performance.now() - started, before, after: memory(), digest: values[0]?.sha256, status: values[0]?.status, progress };
  });
  console.log(`P0-T05 browser ${JSON.stringify(result)}`);
  expect(result.status).toBe('imported');
  expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(result.progress).toEqual([0, 0, 1]);
});
