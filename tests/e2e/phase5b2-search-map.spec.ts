import { expect, test, type Page } from '@playwright/test';

async function seed(page: Page) {
  const origin = test.info().project.use.baseURL as string;
  const external: string[] = [];
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : (external.push(route.request().url()), route.abort('blockedbyclient')));
  await page.goto('/');
  const records = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const { sourceClockEvidence } = await import('../../src/domain/time');
    const db = await LibraryDb.open(), trip = newTrip('合成検索旅行');
    const visit = newVisit(trip.id, '合成Visit', null, { latitude: 32.72, longitude: 129.87 });
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192;
    const context = canvas.getContext('2d')!; context.fillStyle = '#468676'; context.fillRect(0, 0, 256, 192);
    context.fillStyle = '#f5c88d'; context.fillRect(80, 30, 90, 130);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .85));
    const names = ['港の風景.jpg', '山の風景.jpg', '参考位置.jpg', '位置なし.jpg'];
    const photos = names.map((name, index) => {
      const rawDateTimeOriginal = index === 3 ? null : `2026:01:0${index + 1} 10:00:00`;
      const sourceGps = index === 3 ? { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing' as const, issues: [] }
        : index === 2 ? { rawTags: { GPSLatitudeRef: 'N', GPSLatitude: [[32, 1], [43, 1], [12, 1]], GPSLongitudeRef: 'E', GPSLongitude: [[129, 1], [52, 1], [12, 1]] }, normalized: null,
          horizontalErrorMeters: null, datum: null, status: 'suspect' as const, issues: [] }
          : { rawTags: {}, normalized: { latitude: 32.7 + index * .01, longitude: 129.87 }, horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid' as const, issues: [] };
      return photoSchema.parse({ id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: name,
        sourceMime: 'image/jpeg', sourceByteLength: 1_000_000, contentSha256: index.toString(16).padStart(64, '0'), sourceGps,
        gpsCorrection: null, sourceTime: { ...sourceClockEvidence(rawDateTimeOriginal, null), rawDateTimeOriginal,
          rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] }, timeCorrection: null,
        sourceOrientation: null, thumbnailId: index === 3 ? null : crypto.randomUUID(), thumbnailState: index === 3 ? 'failed' : 'available',
        metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null });
    });
    const thumbnails = photos.filter(photo => photo.thumbnailId).map(photo => ({ id: photo.thumbnailId!, photoId: photo.id,
      mime: 'image/jpeg' as const, width: 256, height: 192, byteLength: blob.size, blob }));
    await db.restoreNew({ trips: [trip], visits: [visit], photos, thumbnails,
      links: [{ albumId: visit.id, photoId: photos[0]!.id, createdAt: null }] }); db.close();
    return { tripId: trip.id, photoIds: photos.map(photo => photo.id) };
  });
  await page.reload(); await page.locator('#trip-select').selectOption(records.tripId);
  await expect(page.locator('#photo-count')).toContainText('4件');
  return { ...records, external };
}

test('search, date, GPS and Visit filters keep gallery and map in sync', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { tripId, photoIds, external } = await seed(page);
  await expect.poll(() => page.locator('.map-photo-thumb').count()).toBeGreaterThan(0);
  await expect(page.locator('.map-photo-thumb img').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b2-desktop-map.png' });
  await page.locator('#photo-search').fill('港');
  await expect(page.locator('#photo-count')).toContainText('1件 / 全4件');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await expect(page.locator('#map-marker-count')).toContainText('1地点');
  await page.locator('#photo-list button').click();
  await expect(page.locator('#photo-detail h3')).toHaveText('港の風景.jpg');
  await expect.poll(() => page.locator('.map-photo-thumb.is-selected').count()).toBe(1);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b2-desktop-search.png' });
  await page.locator('#trip-select').selectOption('');
  await expect(page.locator('#photo-count')).toContainText('0件');
  await expect(page.locator('.map-photo-thumb.is-selected')).toHaveCount(0);
  await page.locator('#trip-select').selectOption(tripId);
  await expect(page.locator('#photo-count')).toContainText('1件 / 全4件');
  await page.locator('#photo-search').fill('一致しない');
  await expect(page.locator('#photo-list')).toContainText('検索条件に一致する写真がありません');
  await expect(page.locator('#map-status')).toContainText('検索に一致する写真はありません');
  await page.locator('#photo-filter-clear').click();
  await expect(page.locator('#photo-list button')).toHaveCount(4);
  await page.locator('#photo-filter-more > summary').click();
  await page.locator('#photo-gps-filter').selectOption('none');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await expect(page.locator('#map-status')).toContainText('一致した写真に表示できる位置がありません');
  await page.locator('#photo-gps-filter').selectOption('reference');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await expect(page.locator('#map-marker-count')).toContainText('1地点');
  await page.locator('#photo-gps-filter').selectOption('all');
  await page.locator('#photo-visit-filter').selectOption('linked');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#photo-visit-filter').selectOption('all');
  await page.locator('#photo-date-from').fill('2026-01-02');
  await expect(page.locator('#photo-list button')).toHaveCount(2);
  await page.locator('#photo-filter-clear').click();
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-mode-visits').click();
  await expect(page.locator('#photos-layer-toggle')).not.toBeChecked();
  await expect(page.locator('#visits-layer-toggle')).toBeChecked();
  await expect(page.locator('#map-marker-count')).toContainText('1地点');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b2-desktop-visits.png' });
  await page.locator('#map-mode-photo').click();
  await expect(page.locator('#photos-layer-toggle')).toBeChecked();
  await expect(page.locator('#visits-layer-toggle')).not.toBeChecked();
  await page.reload();
  await page.locator('#trip-select').selectOption(tripId);
  await expect(page.locator('#photos-layer-toggle')).toBeChecked();
  await expect(page.locator('#visits-layer-toggle')).not.toBeChecked();
  await expect(page.locator(`#photo-list button[data-photo-id="${photoIds[0]}"]`)).toHaveCount(1);
  expect(external).toEqual([]);
});

test('map controls and search fit desktop and mobile widths without duplicate navigation', async ({ page }) => {
  await seed(page);
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    if (width <= 700) {
      await page.locator('#mobile-tab-photos').click();
      await expect(page.locator('#left-panel > .panel-top')).toBeHidden();
      await expect(page.locator('#photo-search')).toBeVisible();
      await page.locator('#photo-search').fill('風景');
      await expect(page.locator('#photo-list button')).toHaveCount(2);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `test-results/phase-a-shots/phase5b2-${width}-photos.png` });
      await page.locator('#mobile-tab-map').click();
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: `test-results/phase-a-shots/phase5b2-${width}.png` });
  }
});

test('1,500 photos at one coordinate expose candidates in pages of 100', async ({ page }) => {
  test.setTimeout(90_000);
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
  const tripId = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { sourceClockEvidence } = await import('../../src/domain/time');
    const db = await LibraryDb.open(), trip = newTrip('同一点1500枚');
    const photos = Array.from({ length: 1500 }, (_, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: `same-${index}.jpg`,
      sourceMime: 'image/jpeg', sourceByteLength: 100_000, contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: {}, normalized: { latitude: 32.733, longitude: 129.87 }, horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] },
      gpsCorrection: null, sourceTime: { ...sourceClockEvidence(null, null), rawDateTimeOriginal: null, rawOffsetTimeOriginal: null,
        rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] }, timeCorrection: null,
      sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [],
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    await db.restoreNew({ trips: [trip], visits: [], photos, thumbnails: [] }); db.close(); return trip.id;
  });
  await page.reload(); await page.locator('#trip-select').selectOption(tripId);
  await page.locator('#map-tools > summary').click();
  const clickCenter = async () => {
    const box = await page.locator('#map').boundingBox(); if (!box) throw new Error('Map unavailable');
    await page.locator('#map').click({ position: { x: (box.width + 344 - 16) / 2, y: (box.height + 72 - 16) / 2 } });
  };
  await expect.poll(async () => { if (!(await page.locator('#map-photo-chooser').isVisible())) await clickCenter(); return page.locator('#map-photo-options button').count(); }).toBe(100);
  await expect(page.locator('#map-choice-count')).toContainText('1500件中 1〜100件');
  await page.locator('#map-choice-next').click();
  await expect(page.locator('#map-photo-options button')).toHaveCount(100);
  await expect(page.locator('#map-choice-count')).toContainText('1500件中 101〜200件');
  await expect(page.locator('#map-photo-options button').first()).toContainText('same-');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b2-cluster-1500.png' });
  await page.locator('#map-choice-close').click();
  await page.locator('#map-zoom-in').click(); await page.locator('#map-zoom-in').click();
  await expect.poll(() => page.locator('.map-photo-thumb').count()).toBe(1);
  await expect(page.locator('.map-photo-thumb-count')).toHaveText('1500');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b2-overlap-1500.png' });
  await clickCenter();
  await expect(page.locator('#map-choice-count')).toContainText('1500件中 1〜100件');
});

test('a locally mocked background style keeps photo thumbnails and selection', async ({ page }) => {
  const { photoIds, external } = await seed(page);
  await page.locator(`#photo-list button[data-photo-id="${photoIds[0]}"]`).click();
  await expect.poll(() => page.locator('.map-photo-thumb.is-selected').count()).toBe(1);
  let mockedRequests = 0;
  await page.route('https://tiles.openfreemap.org/**', route => {
    mockedRequests++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e6efe6' } }] }) });
  });
  await page.locator('#map-tools > summary').click();
  await page.locator('#basemap-toggle').check();
  await expect.poll(() => page.locator('.map-photo-thumb img').count()).toBeGreaterThan(0);
  await expect(page.locator('.map-photo-thumb.is-selected')).toHaveCount(1);
  expect(mockedRequests).toBeGreaterThan(0);
  expect(external).toEqual([]);
  await page.locator('#basemap-toggle').uncheck();
  await expect.poll(() => page.locator('.map-photo-thumb img').count()).toBeGreaterThan(0);
});
