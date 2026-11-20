import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('P0-T07 archive transfers synthetic records to a fresh browser context', async ({ page, browser }) => {
  await page.goto('/');
  const thumbnailBytes = Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp'));
  const generated = await page.evaluate(async thumbnail => {
    const { createArchive } = await import('../../spikes/p0-t07/archive');
    const started = performance.now();
    const bytes = await createArchive({
      trips: [{ id: 't1', name: 'synthetic' }], visits: [{ id: 'v1', tripId: 't1' }],
      photos: [{ id: 'p1', tripId: 't1', visitId: 'v1', contentSha256: 'a'.repeat(64), thumbnailId: 'th1' }],
      thumbnail: new Uint8Array(thumbnail),
    });
    return { bytes: Array.from(bytes), elapsedMs: performance.now() - started };
  }, thumbnailBytes);
  const context = await browser.newContext();
  try {
    const cleanPage = await context.newPage();
    await cleanPage.goto('http://127.0.0.1:5184/');
    const restored = await cleanPage.evaluate(async data => {
      const { validateArchive } = await import('../../spikes/p0-t07/archive');
      const started = performance.now();
      const records = await validateArchive(new Uint8Array(data));
      return { trips: records.trips.length, visits: records.visits.length, photos: records.photos.length, thumbnailBytes: records.thumbnail.length, elapsedMs: performance.now() - started };
    }, generated.bytes);
    console.log(`P0-T07 ${JSON.stringify({ archiveBytes: generated.bytes.length, createMs: generated.elapsedMs, ...restored })}`);
    expect(restored).toMatchObject({ trips: 1, visits: 1, photos: 1, thumbnailBytes: 74 });
  } finally {
    await context.close();
  }
});
