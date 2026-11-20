import { expect, test } from '@playwright/test';

for (const count of [1000, 5000]) {
  test(`Visit summary and focus remain bounded with ${count} linked photos`, async ({ page }) => {
    test.setTimeout(300_000);
    const origin = test.info().project.use.baseURL as string;
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const ids = await page.evaluate(async count => {
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const { newTrip, photoSchema, visitSchema } = await import('../../src/domain/model');
      const { newVisit } = await import('../../src/domain/visits');
      const { sourceClockEvidence } = await import('../../src/domain/time');
      const db = await LibraryDb.open(), trip = newTrip(`Visit負荷${count}`);
      const visit = visitSchema.parse({ ...newVisit(trip.id, '合成大量Visit'), userStartAtUtc: '2026-01-01T09:00:00.000Z' });
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
      const blobs: Blob[] = [];
      for (let variant = 0; variant < 6; variant++) {
        canvas.width = variant % 2 ? 160 : 240; canvas.height = variant % 2 ? 240 : 160;
        const pixels = context.createImageData(canvas.width, canvas.height); let random = variant + 1;
        for (let index = 0; index < pixels.data.length; index += 4) {
          random = (Math.imul(random, 1664525) + 1013904223) | 0;
          pixels.data[index] = random & 255; pixels.data[index + 1] = random >>> 8 & 255;
          pixels.data[index + 2] = random >>> 16 & 255; pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        blobs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encode failed')), 'image/jpeg', .78)));
      }
      const photos = Array.from({ length: count }, (_, index) => photoSchema.parse({
        id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: `synthetic-${index}.jpg`,
        sourceMime: 'image/jpeg', sourceByteLength: 4_000_000, contentSha256: index.toString(16).padStart(64, '0'),
        sourceGps: { rawTags: {}, normalized: { latitude: 32.7 + (index % 100) * .0002, longitude: 129.8 + Math.floor(index / 100) * .0002 },
          horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null,
        sourceTime: { ...sourceClockEvidence(`2026:01:${String(index % 28 + 1).padStart(2, '0')} 12:00:00`, null),
          rawDateTimeOriginal: `2026:01:${String(index % 28 + 1).padStart(2, '0')} 12:00:00`, rawOffsetTimeOriginal: null,
          rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] },
        timeCorrection: null, sourceOrientation: null, thumbnailId: crypto.randomUUID(), thumbnailState: 'available',
        metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
      }));
      const thumbnails = photos.map((photo, index) => ({ id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg' as const,
        width: index % 2 ? 160 : 240, height: index % 2 ? 240 : 160, byteLength: blobs[index % blobs.length]!.size,
        blob: blobs[index % blobs.length]! }));
      const seedStart = performance.now();
      const links = photos.map(photo => ({ albumId: visit.id, photoId: photo.id, createdAt: null }));
      await db.restoreNew({ trips: [trip], visits: [visit], photos, thumbnails, links }); db.close();
      return { tripId: trip.id, visitId: visit.id, seedMs: Math.round(performance.now() - seedStart),
        logicalThumbnailMiB: Math.round(thumbnails.reduce((total, thumb) => total + thumb.byteLength, 0) / 1048576),
        thumbnailBytes: blobs.map(blob => blob.size) };
    }, count);
    await page.reload();
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const heap = async () => (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
    const timings: number[] = [];
    for (let run = 0; run < 3; run++) {
      await page.locator('#trip-select').selectOption('');
      const start = Date.now(); await page.locator('#trip-select').selectOption(ids.tripId);
      await expect(page.locator('#visit-count')).toHaveText('1件');
      timings.push(Date.now() - start);
    }
    await page.locator('#left-tab-visits').click();
    const summaryStart = Date.now(); await page.locator(`#visit-list button[data-visit-id="${ids.visitId}"]`).click();
    await expect(page.locator('#visit-summary')).toContainText(`写真 ${count}枚`);
    await expect(page.locator('#visit-summary img')).toHaveCount(3);
    const summaryMs = Date.now() - summaryStart;
    const summaryDom = await page.evaluate(() => document.querySelectorAll('*').length);
    await page.locator('#visit-summary').getByRole('button', { name: '写真を見る' }).click();
    await expect(page.locator('#visit-all-count')).toContainText(`${count}枚`);
    const allDom = await page.evaluate(() => ({ all: document.querySelectorAll('*').length, visiblePhotos: document.querySelectorAll('#visit-all-photo-list button').length }));
    expect(allDom.visiblePhotos).toBeLessThan(80);
    expect(allDom.all).toBeLessThan(1500);
    await page.locator('#visit-all-back').click();
    const focusStart = Date.now(); await page.locator('#visit-summary').getByRole('button', { name: '地図で見る' }).click();
    await expect(page.locator('#visit-focus-message')).toContainText(`位置あり${count}枚`);
    await expect(page.locator('#map-marker-count')).toContainText(`${count}地点`);
    await expect(page.locator('#map canvas')).toHaveCount(1);
    const focusMs = Date.now() - focusStart;
    const markerDom = await page.locator('.map-photo-thumb').count(); expect(markerDom).toBeLessThanOrEqual(64);
    const focusedHeap = await heap();
    await page.locator('#visit-focus-exit').click();
    console.log(`phase5c1-visit-${count}`, JSON.stringify({ ...ids, tripSwitchMs: timings, summaryMs, focusMs,
      summaryDom, allDom, markerDom, focusedHeapBytes: focusedHeap }));
  });
}
