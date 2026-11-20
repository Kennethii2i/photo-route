import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

async function clickMappedCenter(page: import('@playwright/test').Page) {
  const box = await page.locator('#map').boundingBox(); if (!box) throw new Error('Map unavailable');
  const left = await page.locator('body').getAttribute('data-left-open') === 'true' ? 344 : 16;
  const right = await page.locator('body').getAttribute('data-right-open') === 'true' ? 384 : 16;
  await page.locator('#map').click({ position: { x: (box.width + left - right) / 2, y: (box.height + 72 - 16) / 2 } });
}

test('Visit clusters and overlapping Photo/Visit remain individually selectable with thumbnails and keyboard controls', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const thumb = Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp'));
  const seeded = await page.evaluate(async bytes => {
    const storageUrl = '/src/infrastructure/storage.ts', modelUrl = '/src/domain/model.ts', visitsUrl = '/src/domain/visits.ts', imageUrl = '/src/infrastructure/image.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import(modelUrl) as typeof import('../../src/domain/model');
    const { newVisit } = await import(visitsUrl) as typeof import('../../src/domain/visits');
    const { inspectImage } = await import(imageUrl) as typeof import('../../src/infrastructure/image');
    const db = await LibraryDb.open(), trip = newTrip('Phase 3 map trial'); await db.createTrip(trip);
    const size = inspectImage(new Uint8Array(bytes)), photoId = crypto.randomUUID(), thumbnailId = crypto.randomUUID();
    const common = { id: photoId, tripId: trip.id, visitId: null, originalFilename: 'visible.jpg', sourceMime: 'image/jpeg', sourceByteLength: 100,
      contentSha256: 'a'.repeat(64), sourceGps: { rawTags: {}, normalized: { latitude: 32.733, longitude: 129.87 }, horizontalErrorMeters: null,
        datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
        localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, thumbnailId, thumbnailState: 'available', metadataIssues: [],
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null };
    await db.savePhoto(photoSchema.parse(common), { id: thumbnailId, photoId, mime: 'image/webp', width: size.width!, height: size.height!,
      byteLength: bytes.length, blob: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }) });
    await db.savePhoto(photoSchema.parse({ ...common, id: crypto.randomUUID(), originalFilename: 'no-gps.jpg', contentSha256: 'b'.repeat(64),
      sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
      thumbnailId: null, thumbnailState: 'failed' }), null);
    for (let index = 0; index < 10; index++) await db.createVisit(newVisit(trip.id, `Same Visit ${index}`, null, { latitude: 32.733, longitude: 129.87 }));
    const before = await db.snapshot(); db.close(); return { tripId: trip.id, photoId, records: JSON.stringify({ trips: before.trips, visits: before.visits, photos: before.photos }) };
  }, thumb);
  await page.reload(); await page.locator('#trip-select').selectOption(seeded.tripId);
  await expect(page.locator('#photo-list button')).toHaveCount(2);
  await expect(page.locator('#visit-list button')).toHaveCount(10);
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-layer-custom > summary').click();
  await page.locator('#visits-layer-toggle').check();
  await page.locator('#map-zoom-out').click(); await page.locator('#map-zoom-out').click();
  const clickCenter = () => clickMappedCenter(page);
  await expect.poll(async () => { if (!(await page.locator('#visit-map-chooser').isVisible())) await clickCenter(); return page.locator('#visit-map-options button').count(); }).toBe(10);
  await expect(page.locator('#visit-map-chooser')).toBeVisible();
  await expect(page.locator('#map-photo-chooser')).toHaveAttribute('data-kind', 'cluster');
  await expect(page.locator('#map-photo-options button')).toHaveCount(1);
  await expect(page.locator('#map-photo-options button img')).toBeVisible();
  await page.locator('.map-panel').screenshot({ path: 'test-results/phase3-map-chooser.png' });
  await page.locator('#visit-map-options button').filter({ hasText: 'Same Visit 5' }).click();
  await expect(page.locator('#visit-summary')).toContainText('Same Visit 5');
  await expect(page.locator('#visit-list button').filter({ hasText: 'Same Visit 5' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#photo-list button[aria-label="visible.jpg"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#photo-detail h3')).toHaveText('visible.jpg');
  await expect(page.locator('#photo-detail img')).toBeVisible();
  await expect(page.locator('#photo-list button[aria-label="visible.jpg"]')).toHaveAttribute('aria-pressed', 'true');
  const selectedZoom = await page.locator('#map-zoom-level').textContent();
  await page.locator('#map').focus(); await page.keyboard.press('-');
  await expect(page.locator('#map-zoom-level')).not.toHaveText(selectedZoom!);
  await page.keyboard.press('+');
  await expect(page.locator('#map-zoom-level')).toHaveText(selectedZoom!);
  await page.locator('#right-close').click();
  for (let index = 0; index < 4; index++) await page.locator('#map-zoom-in').click();
  await clickCenter();
  await expect(page.locator('#visit-map-chooser')).toBeVisible();
  await expect(page.locator('#map-photo-chooser')).toHaveAttribute('data-kind', 'overlap');
  await page.keyboard.press('Escape');
  await expect(page.locator('#visit-map-chooser')).toBeHidden();
  await expect(page.locator('#map-photo-chooser')).toBeHidden();
  await page.locator('#photos-layer-toggle').uncheck();
  await expect(page.locator('#map-marker-count')).toContainText('10地点');
  await page.locator('#map-marker-index > summary').click();
  await expect(page.locator('#map-marker-list button[data-marker-kind="visit"]')).toHaveCount(10);
  await expect(page.locator('#map-photo-chooser')).toBeHidden();
  await page.locator('#visits-layer-toggle').uncheck();
  await page.locator('#photos-layer-toggle').check();
  await page.locator('#map-marker-list button[data-marker-kind="photo"]').click();
  await expect(page.locator('#photo-detail h3')).toHaveText('visible.jpg');
  await expect(page.locator('#visit-map-chooser')).toBeHidden();
  await page.locator('#map-fit').click();
  const after = await page.evaluate(async () => {
    const url = '/src/infrastructure/storage.ts'; const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const snapshot = await db.snapshot(); db.close();
    return JSON.stringify({ trips: snapshot.trips, visits: snapshot.visits, photos: snapshot.photos });
  });
  expect(after).toBe(seeded.records);
});

test('distant Visits and a GPS-free Photo remain usable through fit, keyboard selection and reload without a basemap', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', route => {
    if (route.request().url().startsWith('http://127.0.0.1:5184/')) void route.continue();
    else { external.push(route.request().url()); void route.abort(); }
  });
  await page.goto('/');
  await page.locator('#header-manage').click();
  await page.locator('#trip-name').fill('Distant Visit trial');
  await page.getByRole('button', { name: '旅行を作成' }).click();
  await page.locator('#management-close').click();
  await page.locator('#left-tab-visits').click();
  for (const [label, latitude, longitude] of [['Nagasaki', '32.733', '129.87'], ['Tokyo', '35.68', '139.76']]) {
    await page.locator('#visit-create-from-list').click();
    await page.locator('#visit-label').fill(label!);
    await page.locator('#visit-latitude').fill(latitude!);
    await page.locator('#visit-longitude').fill(longitude!);
    await page.locator('#visit-save').click();
    await expect(page.locator('#visit-list button').filter({ hasText: label! })).toHaveCount(1);
  }
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles('fixtures/generated/png_no_metadata.png');
  await page.locator('#import-button').click();
  await page.locator('#management-close').click();
  await page.locator('#left-tab-photos').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#photo-list button').click();
  await expect(page.locator('#photo-detail')).toContainText('位置情報なし');
  await expect(page.locator('#basemap-toggle')).not.toBeChecked();
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-layer-custom > summary').click();
  await page.locator('#visits-layer-toggle').check();
  await page.locator('#left-tab-visits').click();
  await page.locator('#visit-list button').filter({ hasText: 'Tokyo' }).focus();
  const beforeSelectionZoom = await page.locator('#map-zoom-level').textContent();
  await page.keyboard.press('Enter');
  await expect(page.locator('#visit-summary')).toContainText('Tokyo');
  await expect(page.locator('#visit-list button').filter({ hasText: 'Tokyo' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map-zoom-level')).toHaveText(beforeSelectionZoom!);
  await page.locator('#map-fit').click();
  await expect(page.locator('#map-zoom-level')).not.toContainText('1.0');
  await page.locator('#visits-layer-toggle').uncheck();
  await expect(page.locator('#map-zoom-level')).toContainText('1.0');
  await page.locator('#visits-layer-toggle').check();
  await expect(page.locator('#map-zoom-level')).not.toContainText('1.0');
  await page.reload();
  await page.locator('#trip-select').selectOption({ label: 'Distant Visit trial' });
  await expect(page.locator('#visit-list button')).toHaveCount(2);
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await expect(page.locator('#basemap-toggle')).not.toBeChecked();
  expect(external).toEqual([]);
});

test('more than one hundred identical-coordinate Visits remain reachable by page', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const tripId = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts', modelUrl = '/src/domain/model.ts', visitsUrl = '/src/domain/visits.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { newTrip } = await import(modelUrl) as typeof import('../../src/domain/model');
    const { newVisit } = await import(visitsUrl) as typeof import('../../src/domain/visits');
    const db = await LibraryDb.open(), trip = newTrip('Many Visits'); await db.createTrip(trip);
    for (let index = 0; index < 105; index++) await db.createVisit(newVisit(trip.id, `Visit ${index}`, null, { latitude: 32.733, longitude: 129.87 }));
    db.close(); return trip.id;
  });
  await page.reload(); await page.locator('#trip-select').selectOption(tripId);
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-layer-custom > summary').click();
  await page.locator('#visits-layer-toggle').check();
  await expect.poll(async () => {
    if (!(await page.locator('#visit-map-chooser').isVisible())) await clickMappedCenter(page);
    return page.locator('#visit-map-chooser').isVisible();
  }).toBe(true);
  await expect(page.locator('#visit-choice-count')).toHaveText('105件中 1〜100件');
  await expect(page.locator('#visit-map-options button')).toHaveCount(100);
  await page.locator('#visit-choice-next').click();
  await expect(page.locator('#visit-choice-count')).toHaveText('105件中 101〜105件');
  await expect(page.locator('#visit-map-options button')).toHaveCount(5);
  const chosen = (await page.locator('#visit-map-options button').first().textContent())!.split(' — ')[0]!;
  await page.locator('#visit-map-options button').first().click();
  await expect(page.locator('#visit-summary')).toContainText(chosen);
});
