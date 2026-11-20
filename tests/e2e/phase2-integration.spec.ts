import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { localUi } from './helpers/ux-rc-flows';
test.use({ actionTimeout: 7000 });

test('Phase 2-A to 2-C integrated map, Visit, trash, Undo and ZIP flow', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const tileRequests: string[] = [];
  const external = await localUi(page, tileRequests);
  await page.goto('/');
  const thumb = Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp'));
  const seeded = await page.evaluate(async bytes => {
    const storageUrl = '/src/infrastructure/storage.ts', modelUrl = '/src/domain/model.ts', imageUrl = '/src/infrastructure/image.ts', visitsUrl = '/src/domain/visits.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import(modelUrl) as typeof import('../../src/domain/model');
    const { inspectImage } = await import(imageUrl) as typeof import('../../src/infrastructure/image');
    const { newVisit } = await import(visitsUrl) as typeof import('../../src/domain/visits');
    const db = await LibraryDb.open(); const trip = newTrip('Integrated trip'); await db.createTrip(trip);
    const size = inspectImage(new Uint8Array(bytes));
    let firstId = '';
    for (let index = 0; index < 10; index++) {
      const id = crypto.randomUUID(), thumbId = index === 0 ? crypto.randomUUID() : null;
      if (index === 0) firstId = id;
      const photo = photoSchema.parse({ id, tripId: trip.id, visitId: null, originalFilename: `sample-${index}.jpg`,
        sourceMime: 'image/jpeg', sourceByteLength: 100, contentSha256: (index + 1).toString(16).repeat(64),
        sourceGps: { rawTags: {}, normalized: { longitude: 129.87, latitude: 32.733 }, horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] },
        gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
          localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
        timeCorrection: null, sourceOrientation: null, thumbnailId: thumbId, thumbnailState: thumbId ? 'available' : 'failed',
        metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null });
      const thumbnail = thumbId ? { id: thumbId, photoId: id, mime: 'image/webp' as const, width: size.width!, height: size.height!,
        byteLength: bytes.length, blob: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }) } : null;
      await db.savePhoto(photo, thumbnail);
    }
    const visit = newVisit(trip.id, 'Integrated Visit', null, { longitude: 129.87, latitude: 32.733 });
    await db.createVisit(visit);
    const first = (await db.listPhotos()).find(photo => photo.id === firstId)!;
    await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: trip, expectedAlbums: [visit],
      changes: [{ beforePhoto: first, expectedLinks: [], afterAlbumIds: [visit.id] }] });
    db.close(); return { tripId: trip.id, visitId: visit.id, firstId };
  }, thumb);
  await page.reload();
  await page.locator('#trip-select').selectOption(seeded.tripId);
  await expect(page.locator('#photo-count')).toContainText('10件');
  await expect(page.locator('#visit-list button')).toHaveCount(1);
  expect(tileRequests.some(url => url.includes('/styles/positron'))).toBe(true);
  await page.locator('#map-tools > summary').click();
  await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');

  await page.locator('#map-marker-index summary').click();
  await page.locator('#map-layer-custom > summary').click();
  await page.locator('#visits-layer-toggle').check();
  await page.locator('#photos-layer-toggle').uncheck();
  await page.locator('#map-marker-list button[data-marker-kind="visit"]').click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await expect(page.locator('#visit-label')).toHaveValue('Integrated Visit');
  await page.locator('#photos-layer-toggle').check(); await page.locator('#visits-layer-toggle').uncheck();
  await page.locator('#map-marker-list button[data-marker-kind="photo"]').filter({ hasText: 'sample-0.jpg' }).click();
  await expect(page.locator('#photo-detail img')).toBeVisible();
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-advanced > summary').click();
  await page.getByRole('button', { name: 'この写真をごみ箱へ' }).click();
  await page.locator('#trash-commit').click();
  await expect(page.locator('#management-panel')).not.toBeVisible();
  await expect(page.locator('#photo-count')).toContainText('9件');
  await page.locator('#header-manage').click();
  await page.locator('#recovery-heading').scrollIntoViewIfNeeded();
  await page.locator('#trash-section > summary').click();
  await page.getByRole('button', { name: '写真: sample-0.jpgを復元' }).click();
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-count')).toContainText('10件');
  await page.locator('#left-tab-visits').click();
  await page.locator('#visit-list button').click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await page.locator('#visit-label').fill('Edited Visit'); await page.locator('#visit-save').click();
  await expect(page.locator('#visit-list button')).toContainText('Edited Visit');
  await page.locator('#header-manage').click();
  await page.locator('#recovery-heading').scrollIntoViewIfNeeded();
  await page.locator('#undo-button').click();
  await page.locator('#management-close').click();
  await expect(page.locator('#visit-list button')).toContainText('Integrated Visit');

  await page.locator('#header-manage').click();
  await page.locator('#archive-heading').scrollIntoViewIfNeeded();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-button').click();
  const download = await downloadPromise; const archive = readFileSync(await download.path());
  const fresh = await browser.newContext();
  try {
    const target = await fresh.newPage(); const targetExternal = await localUi(target); await target.goto('/');
    await target.locator('#header-manage').click();
    await target.locator('#archive-heading').scrollIntoViewIfNeeded();
    await target.locator('#archive-file').setInputFiles({ name: 'integration.zip', mimeType: 'application/zip', buffer: archive });
    await target.locator('#restore-button').click();
    await expect(target.locator('#archive-status')).toContainText('1件の旅行と10件の写真を復元');
    await target.locator('#management-close').click();
    await target.locator('#trip-select').selectOption({ label: 'Integrated trip' });
    await expect(target.locator('#photo-count')).toContainText('10件');
    await expect(target.locator('#visit-list button')).toHaveCount(1);
    await target.locator('#map-tools > summary').click();
    await target.locator('#map-marker-index > summary').click();
    await target.locator('#map-marker-list button[data-marker-kind="photo"]').filter({ hasText: 'sample-0.jpg' }).click();
    await expect(target.locator('#photo-detail img')).toBeVisible();
    await target.getByRole('button', { name: '詳細を見る' }).click();
    await target.locator('#photo-advanced > summary').click();
    await expect(target.locator('#photo-detail')).toContainText('Integrated Visit');
    const restoredLinks = await target.evaluate(async id => {
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const db = await LibraryDb.open(); const albumIds = await db.albumIdsForPhoto(id); db.close(); return albumIds;
    }, seeded.firstId);
    expect(restoredLinks).toEqual([seeded.visitId]);
    expect(targetExternal).toEqual([]);
  } finally { await fresh.close(); }
  expect(external).toEqual([]);
});

test('optional private archive copy upgrades v1 data in an isolated database without altering its source', async ({ page }) => {
  test.skip(!process.env.PHOTO_ROUTE_ARCHIVE, 'Set PHOTO_ROUTE_ARCHIVE to an existing local backup ZIP');
  test.setTimeout(120_000);
  const original = readFileSync(process.env.PHOTO_ROUTE_ARCHIVE!);
  const originalSha256 = createHash('sha256').update(Uint8Array.from(original)).digest('hex');
  const external: string[] = [];
  await page.route('**/*', route => {
    if (route.request().url().startsWith('http://127.0.0.1:5184/')) void route.continue();
    else { external.push(route.request().url()); void route.abort(); }
  });
  await page.goto('/');
  const result = await page.evaluate(async archiveBytes => {
    const archiveUrl = '/src/infrastructure/archive.ts', storageUrl = '/src/infrastructure/storage.ts', modelUrl = '/src/domain/model.ts';
    const { inspectArchive, exportArchive, verifyExportArchive, restoreArchive } = await import(archiveUrl) as typeof import('../../src/infrastructure/archive');
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { validateRelations } = await import(modelUrl) as typeof import('../../src/domain/model');
    const gpsUrl = '/src/domain/gps.ts', mapUrl = '/src/domain/map.ts';
    const { sourceGpsDisplay } = await import(gpsUrl) as typeof import('../../src/domain/gps');
    const { photoPoints } = await import(mapUrl) as typeof import('../../src/domain/map');
    const original = await inspectArchive(new Blob([new Uint8Array(archiveBytes)], { type: 'application/zip' }));
    const name = `phase2-copy-v1-${crypto.randomUUID()}`;
    const opened = indexedDB.open(name, 1);
    opened.onupgradeneeded = () => {
      const db = opened.result; db.createObjectStore('trips', { keyPath: 'id' });
      const photos = db.createObjectStore('photos', { keyPath: 'id' });
      photos.createIndex('byHash', 'contentSha256'); photos.createIndex('byTrip', 'tripId');
      db.createObjectStore('visits', { keyPath: 'id' }).createIndex('byTrip', 'tripId');
      db.createObjectStore('thumbnails', { keyPath: 'id' }); db.createObjectStore('jobs', { keyPath: 'id' });
    };
    const oldDb = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = oldDb.transaction(['trips', 'visits', 'photos', 'thumbnails'], 'readwrite');
    for (const trip of original.trips) tx.objectStore('trips').add(trip);
    for (const visit of original.visits) tx.objectStore('visits').add(visit);
    for (const photo of original.photos) tx.objectStore('photos').add(photo);
    for (const thumb of original.thumbnails) tx.objectStore('thumbnails').add(thumb);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); oldDb.close();
    const upgradedDb = await LibraryDb.open(name); const upgraded = await upgradedDb.snapshot();
    validateRelations(upgraded.trips, upgraded.visits, upgraded.photos, upgraded.thumbnails);
    const byId = <T extends { id: string }>(records: T[]) => [...records].sort((a, b) => a.id.localeCompare(b.id));
    const recordsEqual = JSON.stringify(byId(original.trips)) === JSON.stringify(byId(upgraded.trips)) &&
      JSON.stringify(byId(original.visits)) === JSON.stringify(byId(upgraded.visits)) &&
      JSON.stringify(byId(original.photos)) === JSON.stringify(byId(upgraded.photos));
    const digest = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(byte => byte.toString(16).padStart(2, '0')).join('');
    const originalThumbs = await Promise.all(byId(original.thumbnails).map(async thumb => [thumb.id, thumb.photoId, thumb.byteLength, await digest(thumb.blob)]));
    const upgradedThumbs = await Promise.all(byId(upgraded.thumbnails).map(async thumb => [thumb.id, thumb.photoId, thumb.byteLength, await digest(thumb.blob)]));
    const thumbnailsEqual = JSON.stringify(originalThumbs) === JSON.stringify(upgradedThumbs);
    const exported = await exportArchive(upgraded); await verifyExportArchive(upgraded, exported);
    const restoredDb = await LibraryDb.open(`phase2-copy-restored-${crypto.randomUUID()}`);
    const restoredResult = await restoreArchive(restoredDb, exported);
    const restored = await restoredDb.snapshot();
    const restoredEqual = JSON.stringify(byId(upgraded.trips)) === JSON.stringify(byId(restored.trips)) &&
      JSON.stringify(byId(upgraded.visits)) === JSON.stringify(byId(restored.visits)) &&
      JSON.stringify(byId(upgraded.photos)) === JSON.stringify(byId(restored.photos));
    const restoredThumbs = await Promise.all(byId(restored.thumbnails).map(async thumb => [thumb.id, thumb.photoId, thumb.byteLength, await digest(thumb.blob)]));
    const restoredThumbnailsEqual = JSON.stringify(upgradedThumbs) === JSON.stringify(restoredThumbs);
    const gpsStatuses = Object.fromEntries(['valid', 'suspect', 'invalid', 'missing'].map(status =>
      [status, upgraded.photos.filter(photo => photo.sourceGps.status === status).length]));
    const referencePositions = upgraded.photos.filter(photo => sourceGpsDisplay(photo.sourceGps).state === 'reference').length;
    const mappedPhotos = photoPoints(upgraded.photos).features.length;
    const thumbnailsAvailable = upgraded.photos.filter(photo => photo.thumbnailState === 'available').length;
    const trashed = [upgraded.trips, upgraded.visits, upgraded.photos].flat().filter(item => item.deletedAt !== null).length;
    const coordinatesPreserved = upgraded.photos.every(photo => {
      const source = original.photos.find(item => item.id === photo.id);
      return source && JSON.stringify(source.sourceGps) === JSON.stringify(photo.sourceGps);
    });
    const trashPreserved = upgraded.trips.every(trip => original.trips.find(item => item.id === trip.id)?.deletedAt === trip.deletedAt) &&
      upgraded.visits.every(visit => original.visits.find(item => item.id === visit.id)?.deletedAt === visit.deletedAt) &&
      upgraded.photos.every(photo => original.photos.find(item => item.id === photo.id)?.deletedAt === photo.deletedAt);
    upgradedDb.close(); restoredDb.close();
    return { hasNamedTrip: original.trips.some(trip => trip.name === '長崎'), trips: original.trips.length,
      photos: original.photos.length, visits: original.visits.length, thumbnails: original.thumbnails.length,
      recordsEqual, thumbnailsEqual, restoredEqual, restoredThumbnailsEqual, coordinatesPreserved, trashPreserved,
      gpsStatuses, referencePositions, mappedPhotos, thumbnailsAvailable, trashed, restoredResult: restoredResult.state };
  }, Array.from(original));
  expect(result.hasNamedTrip).toBe(true);
  expect(result.photos).toBe(10);
  expect(result.recordsEqual).toBe(true);
  expect(result.thumbnailsEqual).toBe(true);
  expect(result.restoredEqual).toBe(true);
  expect(result.restoredThumbnailsEqual).toBe(true);
  expect(result.coordinatesPreserved).toBe(true);
  expect(result.trashPreserved).toBe(true);
  expect(result.referencePositions).toBe(10);
  expect(result.mappedPhotos).toBe(10);
  expect(result.thumbnailsAvailable).toBe(10);
  expect(result.restoredResult).toBe('imported');
  expect(external).toEqual([]);
  expect(createHash('sha256').update(Uint8Array.from(readFileSync(process.env.PHOTO_ROUTE_ARCHIVE!))).digest('hex')).toBe(originalSha256);
  console.log('private-archive-isolated-check', JSON.stringify({ archiveBytes: original.length, sha256: originalSha256, trips: result.trips,
    photos: result.photos, visits: result.visits, thumbnails: result.thumbnails, recordsEqual: result.recordsEqual,
    thumbnailsEqual: result.thumbnailsEqual, restoredEqual: result.restoredEqual,
    restoredThumbnailsEqual: result.restoredThumbnailsEqual, coordinatesPreserved: result.coordinatesPreserved,
    trashPreserved: result.trashPreserved, gpsStatuses: result.gpsStatuses,
    referencePositions: result.referencePositions, mappedPhotos: result.mappedPhotos,
    thumbnailsAvailable: result.thumbnailsAvailable,
    trashed: result.trashed, externalRequests: external.length }));
});
