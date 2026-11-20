import { expect, test, type Page } from '@playwright/test';

type SeedPoint = { name: string; latitude: number | null; longitude: number | null };

async function seedTrip(page: Page, points: SeedPoint[]): Promise<string> {
  await page.goto('/');
  const tripId = await page.evaluate(async rows => {
    const storageUrl = '/src/infrastructure/storage.ts', modelUrl = '/src/domain/model.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import(modelUrl) as typeof import('../../src/domain/model');
    const db = await LibraryDb.open();
    const trip = newTrip('Map trial');
    await db.createTrip(trip);
    for (const [index, row] of rows.entries()) {
      const correction = row.latitude === null || row.longitude === null ? null : {
        value: { latitude: row.latitude, longitude: row.longitude }, source: 'manual' as const, correctedAt: trip.createdAt,
      };
      const photo = photoSchema.parse({
        id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: row.name,
        sourceMime: 'image/jpeg', sourceByteLength: 100, contentSha256: (index + 1).toString(16).padStart(64, '0'),
        sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
        gpsCorrection: correction,
        sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
          localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
        timeCorrection: null, sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
      });
      await db.savePhoto(photo, null);
    }
    db.close();
    return trip.id;
  }, points);
  await page.reload();
  await page.locator('#trip-select').selectOption(tripId);
  await expect(page.locator('#photo-count')).toContainText(`${points.length}件`);
  await expect(page.locator('#map-status')).toContainText('写真地点を表示できます');
  return tripId;
}

async function clickMapCenter(page: Page): Promise<void> {
  const box = await page.locator('#map').boundingBox();
  if (!box) throw new Error('map box unavailable');
  const left = await page.locator('body').getAttribute('data-left-open') === 'true' ? 344 : 16;
  const right = await page.locator('body').getAttribute('data-right-open') === 'true' ? 384 : 16;
  await page.locator('#map').click({ position: { x: (box.width + left - right) / 2, y: (box.height + 72 - 16) / 2 } });
}

test('same-coordinate photos remain individually selectable and list selection is reflected', async ({ page }) => {
  await seedTrip(page, Array.from({ length: 3 }, (_, index) => ({ name: `same-${index}.jpg`, latitude: 32.733, longitude: 129.87 })));
  await expect.poll(async () => { if (!(await page.locator('#map-photo-chooser').isVisible())) await clickMapCenter(page); return page.locator('#map-photo-chooser').isVisible(); }).toBe(true);
  await expect(page.locator('#map-photo-options button')).toHaveCount(3);
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-mode-visits').click();
  await expect(page.locator('#map-photo-chooser')).toBeHidden();
  await clickMapCenter(page);
  await expect(page.locator('#map-photo-chooser')).toBeHidden();
  await page.locator('#map-mode-photo').click();
  await expect.poll(async () => { if (!(await page.locator('#map-photo-chooser').isVisible())) await clickMapCenter(page); return page.locator('#map-photo-chooser').isVisible(); }).toBe(true);
  await page.locator('#map-photo-options button').filter({ hasText: 'same-2.jpg' }).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('same-2.jpg');
  await expect(page.locator('#photo-list button[aria-label="same-2.jpg"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#photo-list button[aria-label="same-1.jpg"]').click();
  await expect(page.locator('#photo-detail h3')).toHaveText('same-1.jpg');
  await expect(page.locator('#photo-list button[aria-label="same-1.jpg"]')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.locator('#trip-select').selectOption({ label: 'Map trial' });
  await expect(page.locator('#photo-list button')).toHaveCount(3);
  await expect.poll(async () => { if (!(await page.locator('#map-photo-chooser').isVisible())) await clickMapCenter(page); return page.locator('#map-photo-chooser').isVisible(); }).toBe(true);
});

test('dense and distant photos project as separate points while GPS-free photos stay in the list', async ({ page }) => {
  const dense = Array.from({ length: 10 }, (_, index) => ({ name: `dense-${index}.jpg`, latitude: 32.733 + index * 0.0002, longitude: 129.87 }));
  await seedTrip(page, [...dense, { name: 'distant.jpg', latitude: 35.5, longitude: 139.5 }, { name: 'no-gps.jpg', latitude: null, longitude: null }]);
  const projection = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts', mapUrl = '/src/domain/map.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { photoPoints } = await import(mapUrl) as typeof import('../../src/domain/map');
    const db = await LibraryDb.open();
    const points = photoPoints(await db.listPhotos());
    db.close();
    return points.features.map(feature => feature.geometry.coordinates);
  });
  expect(projection).toHaveLength(11);
  expect(new Set(projection.map(point => point.join(','))).size).toBe(11);
  expect(projection).toContainEqual([129.87, 32.733]);
  expect(projection).toContainEqual([139.5, 35.5]);
  await page.locator('#photo-search').fill('no-gps.jpg');
  await page.locator('#photo-list button[aria-label="no-gps.jpg"]').click();
  await expect(page.locator('#photo-detail')).toContainText('位置情報なし');
  await expect(page.locator('#map-photo-chooser')).toBeHidden();
});

test('ten coincident photos form a zoom-dependent cluster whose members can be chosen', async ({ page }) => {
  const dense = Array.from({ length: 10 }, (_, index) => ({ name: `near-${index}.jpg`, latitude: 32.733, longitude: 129.87 }));
  await seedTrip(page, dense);
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-zoom-out').click();
  await page.locator('#map-zoom-out').click();
  await page.locator('#map-tools > summary').click();
  await expect.poll(async () => {
    if (!(await page.locator('#map-photo-chooser').isVisible())) await clickMapCenter(page);
    return page.locator('#map-photo-chooser').getAttribute('data-kind');
  }).toBe('cluster');
  await expect(page.locator('#map-photo-options button')).toHaveCount(10);
  const chosen = await page.locator('#map-photo-options button').first().textContent();
  await page.locator('#map-photo-options button').first().click();
  await expect(page.locator('#photo-detail h3')).toHaveText(chosen!);
});
