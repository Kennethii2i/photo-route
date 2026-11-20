import { expect, test } from '@playwright/test';

for (const count of [1000, 5000]) {
  test(`${count} synthetic thumbnails keep the gallery bounded and reachable`, async ({ page }) => {
    test.setTimeout(300_000);
    const origin = test.info().project.use.baseURL as string;
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const seeded = await page.evaluate(async count => {
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const { newTrip, photoSchema } = await import('../../src/domain/model');
      const { sourceClockEvidence } = await import('../../src/domain/time');
      const db = await LibraryDb.open(); const trip = newTrip(`合成${count}枚`);
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
      const shapes = [[256, 192], [192, 256], [224, 224]];
      const blobs: Blob[] = [];
      for (let variant = 0; variant < 12; variant++) {
        const [width, height] = shapes[variant % 3]!; canvas.width = width!; canvas.height = height!;
        const pixels = context.createImageData(width!, height!);
        let seed = variant + 1;
        for (let index = 0; index < pixels.data.length; index += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
          pixels.data[index] = seed & 255; pixels.data[index + 1] = (seed >>> 8) & 255;
          pixels.data[index + 2] = (seed >>> 16) & 255; pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        blobs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encode failed')), 'image/jpeg', .76)));
      }
      const photos = Array.from({ length: count }, (_, index) => {
        const day = String(index % 28 + 1).padStart(2, '0');
        const rawDateTimeOriginal = index % 47 === 0 ? null : `2026:01:${day} 12:00:00`;
        const thumbnailId = crypto.randomUUID();
        return photoSchema.parse({
          id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: `synthetic-${index}.jpg`,
          sourceMime: 'image/jpeg', sourceByteLength: 4_000_000, contentSha256: index.toString(16).padStart(64, '0'),
          sourceGps: { rawTags: {}, normalized: { latitude: 32.7 + (index % 100) * .001, longitude: 129.8 + Math.floor(index / 100) * .001 },
            horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] },
          gpsCorrection: null, sourceTime: { ...sourceClockEvidence(rawDateTimeOriginal, null), rawDateTimeOriginal,
            rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] },
          timeCorrection: null, sourceOrientation: null, thumbnailId, thumbnailState: 'available', metadataIssues: [],
          importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
        });
      });
      const thumbnails = photos.map((photo, index) => {
        const variant = index % blobs.length, blob = blobs[variant]!, shape = shapes[variant % 3]!;
        return { id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg' as const,
          width: shape[0]!, height: shape[1]!, byteLength: blob.size, blob };
      });
      const start = performance.now(); await db.restoreNew({ trips: [trip], visits: [], photos, thumbnails });
      const seedMs = Math.round(performance.now() - start); db.close();
      return { tripId: trip.id, seedMs, thumbnailBytesMin: Math.min(...blobs.map(blob => blob.size)),
        thumbnailBytesMax: Math.max(...blobs.map(blob => blob.size)), logicalThumbnailMiB: Math.round(thumbnails.reduce((sum, thumb) => sum + thumb.byteLength, 0) / 1048576) };
    }, count);
    await page.reload();
    await page.locator('#trip-select').selectOption('');
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.get;
      (window as Window & { thumbReads?: number }).thumbReads = 0;
      const live = new Set<string>();
      (window as Window & { liveThumbnailUrls?: Set<string> }).liveThumbnailUrls = live;
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      URL.createObjectURL = blob => { const url = create.call(URL, blob); live.add(url); return url; };
      URL.revokeObjectURL = url => { live.delete(url); revoke.call(URL, url); };
      IDBObjectStore.prototype.get = function (key) {
        if (this.name === 'thumbnails') (window as Window & { thumbReads?: number }).thumbReads!++;
        return original.call(this, key);
      };
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heap = async () => (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
    const heapBefore = await heap();
    const times: number[] = [], heaps: (number | null)[] = [], reads: number[] = [], liveUrls: number[] = [];
    for (let run = 0; run < 12; run++) {
      if (run) await page.locator('#trip-select').selectOption('');
      const start = Date.now();
      await page.locator('#trip-select').selectOption(seeded.tripId);
      await expect(page.locator('#photo-count')).toContainText(`${count}件`);
      await expect(page.locator('#photo-list img').first()).toBeVisible();
      times.push(Date.now() - start);
      const value = await page.evaluate(() => ({
        heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
        reads: (window as Window & { thumbReads?: number }).thumbReads ?? 0,
      }));
      heaps.push(await heap()); reads.push(value.reads);
      liveUrls.push(await page.evaluate(() => (window as Window & { liveThumbnailUrls?: Set<string> }).liveThumbnailUrls?.size ?? -1));
    }
    const searchStart = Date.now();
    await page.locator('#photo-search').fill(`synthetic-${count - 1}`);
    await expect(page.locator('#photo-count')).toContainText(`1件 / 全${count}件`);
    await expect(page.locator('#map-marker-count')).toContainText('1地点');
    const searchMs = Date.now() - searchStart;
    await page.locator('#photo-filter-clear').click();
    await expect(page.locator('#photo-count')).toContainText(`${count}件`);
    const beforeScroll = await page.evaluate(() => ({ totalDom: document.querySelectorAll('*').length,
      galleryButtons: document.querySelectorAll('#photo-list button').length,
      galleryImages: document.querySelectorAll('#photo-list img').length }));
    await page.locator('#left-panel').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
    await expect.poll(async () => page.locator('#photo-list button').count()).toBeGreaterThan(0);
    await expect(page.locator('#photo-list img').first()).toBeVisible();
    await expect.poll(async () => page.evaluate(() => (window as Window & { thumbReads?: number }).thumbReads ?? 0)).toBeGreaterThan(reads.at(-1)!);
    const bottom = await page.evaluate(() => ({ names: [...document.querySelectorAll<HTMLButtonElement>('#photo-list button')].map(button => button.getAttribute('aria-label')),
      totalDom: document.querySelectorAll('*').length, reads: (window as Window & { thumbReads?: number }).thumbReads ?? 0 }));
    expect(beforeScroll.galleryButtons).toBeLessThan(80);
    expect(beforeScroll.galleryImages).toBeLessThan(80);
    expect(bottom.totalDom).toBeLessThan(1500);
    expect(bottom.names.some(name => Number(/synthetic-(\d+)/.exec(name ?? '')?.[1]) > 100)).toBe(true);
    expect(reads[0]).toBeGreaterThan(0);
    expect(reads[0]).toBeLessThan(80);
    const chosenName = await page.locator('#photo-list button').last().getAttribute('aria-label');
    const selectStart = Date.now();
    await page.locator('#photo-list button').last().click();
    await expect(page.locator('#photo-detail h3')).toHaveText(chosenName!);
    const detailMs = Date.now() - selectStart;
    const mapStart = Date.now();
    await page.getByRole('button', { name: '地図で見る' }).click();
    await expect.poll(() => page.locator('.map-photo-thumb').count()).toBeGreaterThan(0);
    const mapMs = Date.now() - mapStart;
    const mapMarkers = await page.locator('.map-photo-thumb').count();
    expect(mapMarkers).toBeLessThanOrEqual(64);
    const mapImages = await page.locator('.map-photo-thumb img').count();
    const mapHeap = await heap();
    await page.locator('#trip-select').selectOption('');
    await expect(page.locator('.map-photo-thumb')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as Window & { liveThumbnailUrls?: Set<string> }).liveThumbnailUrls?.size ?? -1)).toBe(0);
    console.log(`phase5b1-gallery-${count}`, JSON.stringify({ ...seeded, firstDisplayMs: times, heapBeforeBytes: heapBefore, heapBytes: heaps,
      liveUrlsAfterEachDisplay: liveUrls,
      thumbnailReadsAfterEachDisplay: reads, beforeScroll, afterBottomScroll: bottom.totalDom, thumbnailReadsAfterScroll: bottom.reads, detailMs,
      mapMs, mapMarkers, mapImages, mapHeapBytes: mapHeap, searchMs }));
  });
}
