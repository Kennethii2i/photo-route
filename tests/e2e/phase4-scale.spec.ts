import { expect, test } from '@playwright/test';

test('one job imports 1,000 distinct synthetic images with bounded serial work', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { exportArchive } = await import('../../src/infrastructure/archive');
    const db = await LibraryDb.open(`phase4-import-${crypto.randomUUID()}`);
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!;
    const files: File[] = [];
    for (let index = 0; index < 1000; index++) {
      context.fillStyle = `rgb(${index & 255},${(index >> 8) & 255},${(index * 73) & 255})`;
      context.fillRect(0, 0, 16, 16);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encode failed')), 'image/png'));
      files.push(new File([blob], `synthetic-${index}.png`, { type: 'image/png' }));
    }
    const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const before = heap(), start = performance.now();
    let last = start, longestProgressGapMs = 0;
    let expectedTick = start + 16, maxTimerDelayMs = 0;
    const timer = window.setInterval(() => { const now = performance.now(); maxTimerDelayMs = Math.max(maxTimerDelayMs, now - expectedTick); expectedTick = now + 16; }, 16);
    const progress = await new PhotoImporter(db).importFiles(files, null, () => {
      const now = performance.now(); longestProgressGapMs = Math.max(longestProgressGapMs, now - last); last = now;
    });
    window.clearInterval(timer);
    const elapsedMs = Math.round(performance.now() - start);
    const saved = await db.snapshot(), jobs = await db.listJobs();
    const archive = await exportArchive(saved);
    db.close();
    return { elapsedMs, heapBefore: before, heapAfter: heap(), longestProgressGapMs: Math.round(longestProgressGapMs), maxTimerDelayMs: Math.round(maxTimerDelayMs),
      outcomes: Object.fromEntries(['imported', 'partial', 'skipped-duplicate', 'failed', 'cancelled'].map(state => [state, progress.outcomes.filter(x => x.state === state).length])),
      savedPhotos: saved.photos.length, savedThumbnails: saved.thumbnails.length, jobState: jobs[0]?.state, processed: jobs[0]?.processed, backupBytes: archive.size };
  });
  console.log('phase4-import-1000', JSON.stringify(result));
  expect(result.outcomes).toMatchObject({ imported: 1000, partial: 0, 'skipped-duplicate': 0, failed: 0, cancelled: 0 });
  expect(result).toMatchObject({ savedPhotos: 1000, savedThumbnails: 1000, jobState: 'completed', processed: 1000 });
  expect(result.backupBytes).toBeGreaterThan(0);
});

test('5,000 synthetic located Photos reload and remain selectable on the map', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  const seeded = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const db = await LibraryDb.open();
    const trip = newTrip('Phase 4 synthetic scale');
    const photos = Array.from({ length: 5000 }, (_, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: `synthetic-${index}.jpg`,
      sourceMime: 'image/jpeg', sourceByteLength: 100, contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: {}, normalized: { latitude: 32.7 + (index % 100) * 0.0001, longitude: 129.8 + Math.floor(index / 100) * 0.0001 },
        horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
        localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [],
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    const start = performance.now(); await db.restoreNew({ trips: [trip], visits: [], photos, thumbnails: [] });
    const seedMs = Math.round(performance.now() - start); db.close();
    return { tripId: trip.id, firstId: photos[0]!.id, seedMs };
  });
  const start = Date.now(); await page.reload();
  await page.locator('#trip-select').selectOption(seeded.tripId);
  await expect(page.locator('#photo-count')).toContainText('5000件');
  await expect(page.locator('#map-status')).toContainText('写真地点を表示できます');
  const renderMs = Date.now() - start;
  const metrics = await page.evaluate(async firstId => {
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const listButtons = document.querySelectorAll('#photo-list button').length;
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const saved = await db.listPhotos(); db.close();
    return { heap, listButtons, savedPhotos: saved.length, firstPresent: saved.some(photo => photo.id === firstId),
      canvas: Boolean(document.querySelector('#map canvas')), mapText: document.querySelector('#map-status')?.textContent };
  }, seeded.firstId);
  console.log('phase4-map-5000', JSON.stringify({ ...seeded, renderMs, ...metrics }));
  expect(metrics).toMatchObject({ savedPhotos: 5000, firstPresent: true, canvas: true });
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-marker-index summary').click();
  await expect(page.locator('#map-marker-count')).toContainText('5000地点中 1〜100地点');
  await expect(page.locator('#map-marker-list button')).toHaveCount(100);
  await page.locator('#map-marker-next').click();
  await expect(page.locator('#map-marker-count')).toContainText('101〜200地点');
  await page.locator('#map-marker-list button').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#photo-detail h3')).toBeVisible();
  await expect(page.locator('#map-marker-list button').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#photo-search').fill('synthetic-0.jpg');
  await page.locator(`#photo-list button[data-photo-id="${seeded.firstId}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('synthetic-0.jpg');
});

test('five 1,000-photo jobs accumulate 5,000 thumbnails and Photos without overwrites', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const db = await LibraryDb.open(`phase4-cumulative-${crypto.randomUUID()}`);
    const importer = new PhotoImporter(db);
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!;
    const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const heapBefore = heap(), start = performance.now();
    const jobResults: number[] = [];
    for (let job = 0; job < 5; job++) {
      const files: File[] = [];
      for (let offset = 0; offset < 1000; offset++) {
        const index = job * 1000 + offset;
        context.fillStyle = `rgb(${index & 255},${(index >> 8) & 255},${(index * 73) & 255})`;
        context.fillRect(0, 0, 16, 16);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encode failed')), 'image/png'));
        files.push(new File([blob], `cumulative-${index}.png`, { type: 'image/png' }));
      }
      const outcome = await importer.importFiles(files, null);
      jobResults.push(outcome.outcomes.filter(item => item.state === 'imported').length);
    }
    const elapsedMs = Math.round(performance.now() - start);
    const snapshot = await db.snapshot(), jobs = await db.listJobs(); db.close();
    return { elapsedMs, heapBefore, heapAfter: heap(), jobResults, photos: snapshot.photos.length,
      thumbnails: snapshot.thumbnails.length, uniqueHashes: new Set(snapshot.photos.map(photo => photo.contentSha256)).size,
      completedJobs: jobs.filter(job => job.state === 'completed').length };
  });
  console.log('phase4-cumulative-5000', JSON.stringify(result));
  expect(result).toMatchObject({ jobResults: [1000, 1000, 1000, 1000, 1000], photos: 5000,
    thumbnails: 5000, uniqueHashes: 5000, completedJobs: 5 });
});

test('the 1,000-photo import UI updates totals and results without rebuilding the full list', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!; const transfer = new DataTransfer();
    for (let index = 0; index < 1000; index++) {
      context.fillStyle = `rgb(${index & 255},${(index >> 8) & 255},${(index * 73) & 255})`;
      context.fillRect(0, 0, 16, 16);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encode failed')), 'image/png'));
      transfer.items.add(new File([blob], `ui-${index}.png`, { type: 'image/png' }));
    }
    (document.querySelector('#photo-files') as HTMLInputElement).files = transfer.files;
    document.body.dataset.phase4Start = String(performance.now());
    (document.querySelector('#import-button') as HTMLButtonElement).click();
  });
  await expect(page.locator('#import-status')).toContainText('1000/1000件を処理（completed）', { timeout: 300_000 });
  await expect(page.locator('#photo-count')).toContainText('1000件');
  const result = await page.evaluate(() => ({ elapsedMs: Math.round(performance.now() - Number(document.body.dataset.phase4Start)),
    results: document.querySelectorAll('#import-results li').length, visiblePhotos: document.querySelectorAll('#photo-list button').length,
    status: document.querySelector('#import-status')?.textContent }));
  console.log('phase4-import-ui-1000', JSON.stringify(result));
  expect(result.results).toBe(1000);
  expect(result.visiblePhotos).toBeLessThan(100);
  expect(result.status).toContain('成功 1000件');
  if (await page.locator('#management-close').isVisible()) await page.locator('#management-close').click();
  await page.locator('#photo-search').fill('ui-999.png');
  await expect(page.locator('#photo-list button[aria-label="ui-999.png"]')).toHaveCount(1);
});
