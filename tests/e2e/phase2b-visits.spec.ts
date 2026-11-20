import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function makeTrip(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('#header-manage').click();
  await page.getByLabel('新しい旅行名').fill(name);
  await page.getByRole('button', { name: '旅行を作成' }).click();
  await expect(page.locator('#trip-select')).toHaveValue(/.+/);
  await page.locator('#management-close').click();
}

async function clickMapCenter(page: Page): Promise<void> {
  const box = await page.locator('#map').boundingBox();
  if (!box) throw new Error('Map not available');
  const left = await page.locator('body').getAttribute('data-left-open') === 'true' ? 392 : 16;
  const right = await page.locator('body').getAttribute('data-right-open') === 'true' ? 432 : 16;
  await page.locator('#map').click({ position: { x: (box.width + left - right) / 2, y: (box.height + 76 - 16) / 2 } });
}

async function openVisitEditing(page: Page): Promise<void> {
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
}

async function openAdvancedLayers(page: Page): Promise<void> {
  await page.locator('#map-tools > summary').click();
  if (await page.locator('#map-layer-custom').getAttribute('open') === null) await page.locator('#map-layer-custom > summary').click();
}

test('Visit can be empty, edited, repeated at one place, selected on map and survives reload', async ({ page }) => {
  await makeTrip(page, 'Visit test');
  await page.locator('#left-tab-visits').click();
  await page.locator('#visit-create-from-list').click();
  await page.locator('#visit-label').fill('写真なし');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-list button')).toHaveCount(1);
  await expect(page.locator('#visit-list button')).toContainText('写真0枚 · 位置なし');
  await openVisitEditing(page);
  await expect(page.locator('#visit-delete')).toBeEnabled();

  await page.locator('#visit-label').fill('一回目');
  await page.locator('#visit-latitude').fill('91');
  await page.locator('#visit-longitude').fill('129.87');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-status')).toContainText('緯度・経度の範囲');
  await expect(page.locator('#visit-list button')).toContainText('写真なし');
  await page.locator('#visit-latitude').fill('32.73');
  await page.locator('#visit-start').fill('2026-01-01T09:00:00.000Z');
  await page.locator('#visit-end').fill('2026-01-01T10:00:00.000Z');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-list button')).toContainText('一回目');

  await page.locator('#visit-create-from-list').click();
  await page.locator('#visit-label').fill('二回目');
  await page.locator('#visit-latitude').fill('32.73');
  await page.locator('#visit-longitude').fill('129.87');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-list button')).toHaveCount(2);
  const ids = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const visits = await db.listVisits(); db.close(); return visits;
  });
  expect(new Set(ids.map(visit => visit.id)).size).toBe(2);
  expect(ids.every(visit => visit.representativeLocation?.latitude === 32.73)).toBe(true);
  await openAdvancedLayers(page);
  await page.locator('#visits-layer-toggle').check();
  await page.locator('#map-tools > summary').click();
  await expect.poll(async () => {
    if (!(await page.locator('#visit-map-chooser').isVisible())) await clickMapCenter(page);
    return page.locator('#visit-map-options button').count();
  }).toBe(2);
  await page.locator('#visit-map-options button').filter({ hasText: '一回目' }).click();
  await openVisitEditing(page);
  await expect(page.locator('#visit-label')).toHaveValue('一回目');
  await openAdvancedLayers(page);
  await page.locator('#visits-layer-toggle').uncheck();
  await page.locator('#map-tools > summary').click();
  await clickMapCenter(page);
  await expect(page.locator('#visit-map-chooser')).toBeHidden();
  await openAdvancedLayers(page);
  await page.locator('#photos-layer-toggle').uncheck();
  await page.locator('#visits-layer-toggle').check();
  await page.locator('#map-tools > summary').click();
  await expect.poll(async () => {
    if (!(await page.locator('#visit-map-chooser').isVisible())) await clickMapCenter(page);
    return page.locator('#visit-map-chooser').isVisible();
  }).toBe(true);
  await page.reload();
  await page.locator('#trip-select').selectOption({ label: 'Visit test' });
  await expect(page.locator('#visit-list button')).toHaveCount(2);
  await page.locator('#left-tab-visits').click();
  await page.locator('#visit-list button').filter({ hasText: '二回目' }).click();
  await openVisitEditing(page);
  await expect(page.locator('#visit-label')).toHaveValue('二回目');
});

test('photo GPS remains independent of album position and ZIP v2 retains links', async ({ page }) => {
  await makeTrip(page, 'Linked album');
  await page.locator('#header-add').click();
  for (const [name, path, count] of [
    ['known.jpg', 'fixtures/generated/jpeg_gps_offset_orientation6.jpg', 1],
    ['unknown.jpg', 'fixtures/generated/jpeg_gps_no_datum.jpg', 2],
  ] as const) {
    await page.locator('#photo-files').setInputFiles({ name, mimeType: 'image/jpeg', buffer: readFileSync(path) });
    await page.locator('#import-button').click();
    await expect(page.locator('#photo-list button[data-photo-id]')).toHaveCount(count);
  }
  const result = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newVisit } = await import('../../src/domain/visits');
    const { exportArchive, restoreArchive } = await import('../../src/infrastructure/archive');
    const db = await LibraryDb.open();
    const before = await db.snapshot();
    const trip = before.trips[0]!, known = before.photos.find(photo => photo.originalFilename === 'known.jpg')!;
    const unknown = before.photos.find(photo => photo.originalFilename === 'unknown.jpg')!;
    const knownAlbum = newVisit(trip.id, '確認済み位置', known);
    const unknownAlbum = newVisit(trip.id, '参考位置', unknown);
    await db.createVisit(knownAlbum); await db.createVisit(unknownAlbum);
    await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: trip,
      expectedAlbums: [knownAlbum, unknownAlbum], changes: [
        { beforePhoto: known, expectedLinks: [], afterAlbumIds: [knownAlbum.id] },
        { beforePhoto: unknown, expectedLinks: [], afterAlbumIds: [unknownAlbum.id] },
      ] });
    const after = await db.snapshot();
    const zip = await exportArchive(after);
    const target = await LibraryDb.open(`phase2b-restored-${crypto.randomUUID()}`);
    await restoreArchive(target, zip);
    const restored = await target.snapshot();
    db.close(); target.close();
    return {
      knownPosition: knownAlbum.representativeLocation, unknownPosition: unknownAlbum.representativeLocation,
      sourcesUnchanged: before.photos.every(photo => {
        const saved = after.photos.find(item => item.id === photo.id);
        return JSON.stringify(photo) === JSON.stringify(saved);
      }),
      links: after.links.length, restoredLinks: restored.links.length,
      afterSources: after.photos.map(({ id, sourceGps, sourceTime, gpsCorrection, timeCorrection, contentSha256 }) =>
        ({ id, sourceGps, sourceTime, gpsCorrection, timeCorrection, contentSha256 })),
      restoredSources: restored.photos.map(({ id, sourceGps, sourceTime, gpsCorrection, timeCorrection, contentSha256 }) =>
        ({ id, sourceGps, sourceTime, gpsCorrection, timeCorrection, contentSha256 })),
    };
  });
  expect(result.knownPosition).not.toBeNull();
  expect(result.unknownPosition).toBeNull();
  expect(result).toMatchObject({ sourcesUnchanged: true, links: 2, restoredLinks: 2 });
  expect(result.restoredSources).toEqual(result.afterSources);
});

test('v3 rejects legacy membership writes and cross-trip links without mutation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const db = await LibraryDb.open(`phase2b-atomic-${crypto.randomUUID()}`);
    const a = newTrip('A'), b = newTrip('B');
    await db.createTrip(a); await db.createTrip(b);
    const photo = photoSchema.parse({ id: crypto.randomUUID(), tripId: a.id, visitId: null, originalFilename: 'source.jpg',
      sourceMime: 'image/jpeg', sourceByteLength: 1, contentSha256: 'b'.repeat(64),
      sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
      gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
        localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [],
      importedAt: a.createdAt, updatedAt: a.createdAt, deletedAt: null });
    await db.savePhoto(photo, null);
    const other = newVisit(b.id, 'Other'); await db.createVisit(other);
    const before = JSON.stringify(await db.snapshot());
    let singleRejected = false, createRejected = false, batchRejected = false, crossTripRejected = false;
    try { await db.setPhotoVisit(photo.id, other.id); } catch { singleRejected = true; }
    try { await db.createVisit(newVisit(a.id, 'Legacy'), [photo.id]); } catch { createRejected = true; }
    try { await db.savePhotoVisitBatch({} as Parameters<typeof db.savePhotoVisitBatch>[0]); } catch { batchRejected = true; }
    try {
      await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: a,
        expectedAlbums: [other], changes: [{ beforePhoto: photo, expectedLinks: [], afterAlbumIds: [other.id] }] });
    } catch { crossTripRejected = true; }
    const after = JSON.stringify(await db.snapshot()); db.close();
    return { singleRejected, createRejected, batchRejected, crossTripRejected, unchanged: before === after };
  });
  expect(result).toEqual({ singleRejected: true, createRejected: true, batchRejected: true, crossTripRejected: true, unchanged: true });
});

test('a map click can set a new Visit position without changing photos', async ({ page }) => {
  await makeTrip(page, 'Map Visit');
  await page.locator('#map-tools > summary').click();
  await page.locator('#visit-map-create').click();
  const box = await page.locator('#map').boundingBox();
  if (!box) throw new Error('Map not available');
  await page.locator('#map').click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator('#visit-status')).toContainText('保存するまでアルバムは作成されません');
  await expect(page.locator('#visit-list button')).toHaveCount(0);
  await expect(page.locator('#visit-latitude')).not.toBeEmpty();
  await expect(page.locator('#visit-longitude')).not.toBeEmpty();
  await page.locator('#visit-label').fill('地図から');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-list button')).toHaveCount(1);
  await expect(page.locator('#visit-summary')).toContainText('代表位置あり');
});
