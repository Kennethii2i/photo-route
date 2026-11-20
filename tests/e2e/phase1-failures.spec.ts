import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('P1 import isolates injected quota failure and cancellation after committed records', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const source = {
    jpeg: Array.from(readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg')),
    png: Array.from(readFileSync('fixtures/generated/png_exif_gps.png')),
    webp: Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp')),
  };
  const result = await page.evaluate(async data => {
    const storageUrl = '/src/infrastructure/storage.ts', importerUrl = '/src/application/import-photos.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { PhotoImporter } = await import(importerUrl) as typeof import('../../src/application/import-photos');
    const db = await LibraryDb.open('phase1-failure-injection');
    const originalSave = db.savePhoto.bind(db);
    let calls = 0;
    db.savePhoto = async (photo, thumb) => { if (++calls === 2) throw new DOMException('quota injected', 'QuotaExceededError'); await originalSave(photo, thumb); };
    const first = await new PhotoImporter(db).importFiles([
      new File([new Uint8Array(data.jpeg)], 'first.jpg'), new File([new Uint8Array(data.png)], 'second.png'),
    ], null);
    const afterQuota = await db.snapshot();
    const invalid = await new PhotoImporter(db).importFiles([new File([new Uint8Array([1, 2, 3])], 'invalid.jpg')], null);
    const importer = new PhotoImporter(db);
    const second = await importer.importFiles([
      new File([new Uint8Array(data.png)], 'first.jpg'), new File([new Uint8Array(data.webp)], 'fourth.webp'),
    ], null, progress => { if (progress.job.processed === 1) importer.cancel(); });
    const final = await db.snapshot(); db.close();
    return { quotaStates: first.outcomes.map(x => x.state), quotaError: first.outcomes[1]?.reason, afterQuota: { photos: afterQuota.photos.length, thumbs: afterQuota.thumbnails.length }, invalidState: invalid.outcomes[0]?.state, cancelStates: second.outcomes.map(x => x.state), final: { photos: final.photos.length, thumbs: final.thumbnails.length } };
  }, source);
  expect(result.quotaStates).toEqual(['imported', 'failed']);
  expect(result.quotaError).toContain('quota injected');
  expect(result.afterQuota).toEqual({ photos: 1, thumbs: 1 });
  expect(result.invalidState).toBe('failed');
  expect(result.cancelStates).toEqual(['imported', 'cancelled']);
  expect(result.final.photos).toBe(2);
  await page.evaluate(async () => {
    const url = '/src/infrastructure/storage.ts';
    const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    await db.saveJob({ id: crypto.randomUUID(), startedAt: new Date().toISOString(), targetTripId: null, total: 2, processed: 1, state: 'running', lastError: null });
    db.close();
  });
  await page.reload();
  await expect(page.locator('#import-status')).toContainText('前回の取り込み');
  const interrupted = await page.evaluate(async () => {
    const url = '/src/infrastructure/storage.ts';
    const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const states = (await db.listJobs()).map(x => x.state); db.close(); return states;
  });
  expect(interrupted).toContain('interrupted');
});
