import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('P0-T09 synthetic image parsing, decode and hash have no HTTP egress', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const requests: { method: string; url: string; bodyBytes: number }[] = [];
  context.on('request', request => requests.push({ method: request.method(), url: request.url(), bodyBytes: request.postDataBuffer()?.length ?? 0 }));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5184') return route.abort();
    return route.continue();
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      let calls = 0;
      Object.defineProperty(window, '__geoCalls', { get: () => calls });
      const deny = () => { calls++; throw new Error('Unexpected geolocation call'); };
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: deny, watchPosition: deny }, configurable: true });
    });
    await page.goto('/spikes/p0-t03/browser.html');
    const data = Array.from(readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg'));
    const result = await page.evaluate(async bytes => {
      const { hashQueue } = await import('../../spikes/p0-t05/hash-queue');
      const source = new Uint8Array(bytes);
      const metadata = await window.p0ExifProbe!.read(source);
      const bitmap = await createImageBitmap(new Blob([source], { type: 'image/jpeg' }));
      const canvas = document.createElement('canvas');
      canvas.width = 6; canvas.height = 8;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, 6, 8);
      bitmap.close();
      const thumbnail = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg'));
      const hash = await hashQueue([{ name: 'synthetic.jpg', bytes: new Blob([source]) }], { concurrency: 1, maxBytes: 1024 * 1024 });
      return { hasExifDate: Boolean(metadata.rawDateTimeOriginal), thumbBytes: thumbnail.size, hash: hash[0]?.sha256, geoCalls: (window as Window & { __geoCalls?: number }).__geoCalls };
    }, data);
    await page.goto('/spikes/p0-t08/map.html');
    await expect(page.locator('#map')).toHaveAttribute('data-state', 'loaded', { timeout: 15_000 });
    const geoCallsAfterMap = await page.evaluate(() => (window as Window & { __geoCalls?: number }).__geoCalls);
    const external = requests.filter(request => !request.url.startsWith('http://127.0.0.1:5184/'));
    const posts = requests.filter(request => request.method !== 'GET');
    console.log(`P0-T09 ${JSON.stringify({ result, geoCallsAfterMap, requestCount: requests.length, external, posts })}`);
    expect(result.hasExifDate).toBe(true);
    expect(result.thumbBytes).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.geoCalls).toBe(0);
    expect(geoCallsAfterMap).toBe(0);
    expect(external).toEqual([]);
    expect(posts).toEqual([]);
  } finally {
    await context.close();
  }
});
