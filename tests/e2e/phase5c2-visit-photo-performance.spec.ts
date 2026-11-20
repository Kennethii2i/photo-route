import { expect, test } from '@playwright/test';

for (const count of [1000, 5000]) {
  test(`Visit photo editor keeps DOM and thumbnails bounded at ${count} photos`, async ({ page }) => {
    test.setTimeout(300_000);
    const origin = test.info().project.use.baseURL as string;
    const external: string[] = [];
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue()
      : (external.push(route.request().url()), route.abort('blockedbyclient')));
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/');
    const ids = await page.evaluate(async count => {
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const { newTrip, photoSchema } = await import('../../src/domain/model');
      const { newVisit } = await import('../../src/domain/visits');
      const { sourceClockEvidence } = await import('../../src/domain/time');
      const db = await LibraryDb.open(), trip = newTrip(`合成C2大量${count}`), visit = newVisit(trip.id, '合成Visit');
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
      canvas.width = 240; canvas.height = 160;
      const pixels = context.createImageData(240, 160); let random = 19;
      for (let index = 0; index < pixels.data.length; index += 4) {
        random = Math.imul(random, 1664525) + 1013904223;
        pixels.data[index] = random & 255; pixels.data[index + 1] = random >>> 8 & 255;
        pixels.data[index + 2] = random >>> 16 & 255; pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .8));
      const photos = Array.from({ length: count }, (_, index) => photoSchema.parse({
        id: crypto.randomUUID(), tripId: trip.id, visitId: null,
        originalFilename: `synthetic-${String(index).padStart(5, '0')}.jpg`, sourceMime: 'image/jpeg',
        sourceByteLength: 3_000_000, contentSha256: index.toString(16).padStart(64, '0'),
        sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
        gpsCorrection: null, sourceTime: { ...sourceClockEvidence(null, null), rawDateTimeOriginal: null,
          rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] }, timeCorrection: null,
        sourceOrientation: null, thumbnailId: crypto.randomUUID(), thumbnailState: 'available', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
      }));
      const thumbnails = photos.map(photo => ({ id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg' as const,
        width: 240, height: 160, byteLength: blob.size, blob }));
      const links = photos.slice(0, 100).map(photo => ({ albumId: visit.id, photoId: photo.id, createdAt: null }));
      await db.restoreNew({ trips: [trip], visits: [visit], photos, thumbnails, links }); db.close();
      return { tripId: trip.id, visitId: visit.id, thumbBytes: blob.size };
    }, count);
    await page.reload(); await page.locator('#trip-select').selectOption(ids.tripId);
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const heap = async () => (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
    await page.locator('#header-left').click();
    await page.locator('#left-tab-visits').click();
    await page.locator(`#visit-list button[data-visit-id="${ids.visitId}"]`).click();
    await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
    const start = Date.now(); await page.locator('#visit-photo-edit-open').click();
    await expect(page.locator('#vpe-filter-count')).toContainText(`全${count - 100}枚`);
    const openMs = Date.now() - start;
    const initialDom = await page.evaluate(() => ({ all: document.querySelectorAll('*').length,
      tiles: document.querySelectorAll('.vpe-tile').length,
      visibleImages: document.querySelectorAll('.vpe-tile img').length }));
    expect(initialDom.tiles).toBeLessThan(60);
    expect(initialDom.all).toBeLessThan(1500);
    if (count === 1000) await page.screenshot({ path: 'test-results/phase-a-shots/phase5c2-desktop-900-grid.png' });
    const initialHeap = await heap();
    const searchStart = Date.now(); await page.locator('#vpe-search').fill(`synthetic-${String(count - 1).padStart(5, '0')}`);
    await expect(page.locator('#vpe-filter-count')).toContainText('追加候補 1枚');
    await expect(page.getByRole('button', { name: `synthetic-${String(count - 1).padStart(5, '0')}.jpgをプレビュー` })).toBeVisible();
    const searchMs = Date.now() - searchStart;
    const afterSearchDom = await page.evaluate(() => ({ all: document.querySelectorAll('*').length, tiles: document.querySelectorAll('.vpe-tile').length }));
    await page.locator('#vpe-search').fill('');
    await page.locator('#vpe-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('.vpe-tile').last()).toBeVisible();
    const endHeap = await heap();
    console.log(`phase5c2-editor-${count}`, JSON.stringify({ ...ids, openMs, searchMs, initialDom, afterSearchDom,
      initialHeapBytes: initialHeap, endHeapBytes: endHeap, logicalThumbnailMiB: Math.round(ids.thumbBytes * count / 1048576) }));
    expect(external).toEqual([]);
  });
}
