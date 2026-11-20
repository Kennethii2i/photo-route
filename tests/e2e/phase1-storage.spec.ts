import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('P1 storage and import persist source truth with partial HEIC and no original bytes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const jpeg = Array.from(readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg'));
  const heic = Array.from(readFileSync('fixtures/heif/synthetic_gps_offset_orientation.heic'));
  const first = await page.evaluate(async ({ jpegBytes, heicBytes }) => {
    const storageUrl = '/src/infrastructure/storage.ts';
    const importerUrl = '/src/application/import-photos.ts';
    const modelUrl = '/src/domain/model.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { PhotoImporter } = await import(importerUrl) as typeof import('../../src/application/import-photos');
    const { newTrip } = await import(modelUrl) as typeof import('../../src/domain/model');
    const db = await LibraryDb.open('phase1-test-import');
    const trip = newTrip('Synthetic trip');
    await db.createTrip(trip);
    const visit = { id: crypto.randomUUID(), tripId: trip.id, label: 'Empty Visit', representativeLocation: null, locationSource: 'none' as const, representativePhotoId: null, userStartAtUtc: null, userEndAtUtc: null, createdAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null };
    await db.createVisit(visit);
    const input = [new File([new Uint8Array(jpegBytes)], 'test.jpg'), new File([new Uint8Array(heicBytes)], 'test.heic')];
    const importer = new PhotoImporter(db);
    const report = await importer.importFiles(input, trip.id);
    const beforeDuplicate = await db.listPhotos();
    const duplicate = await importer.importFiles([input[0]!], trip.id);
    const photos = await db.listPhotos();
    const thumbnails = await db.listThumbnails();
    db.close();
    return { tripId: trip.id, visitId: visit.id, outcomes: report.outcomes.map(x => x.state), duplicate: duplicate.outcomes[0]?.state, unchanged: JSON.stringify(beforeDuplicate) === JSON.stringify(photos), photos, thumbnailCount: thumbnails.length, thumbnailSize: thumbnails[0]?.blob.size ?? 0 };
  }, { jpegBytes: jpeg, heicBytes: heic });
  expect(first.outcomes).toEqual(['imported', 'partial']);
  expect(first.duplicate).toBe('skipped-duplicate');
  expect(first.unchanged).toBe(true);
  expect(first.thumbnailCount).toBe(1);
  expect(first.photos.find(x => x.sourceMime === 'image/jpeg')?.sourceGps.normalized).toEqual({ longitude: 139.5, latitude: 35.5 });
  expect(first.photos.find(x => x.sourceMime === 'image/heic')?.thumbnailState).toBe('failed');
  expect(first.photos.find(x => x.sourceMime === 'image/heic')?.sourceOrientation).toBe(6);
  expect(JSON.stringify(first.photos)).not.toContain('JFIF');
  await page.reload();
  const second = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open('phase1-test-import');
    const snapshot = await db.snapshot();
    db.close();
    return { tripIds: snapshot.trips.map(x => x.id), visitIds: snapshot.visits.map(x => x.id), photoCount: snapshot.photos.length, thumbnailSize: snapshot.thumbnails[0]?.blob.size ?? 0 };
  });
  expect(second).toEqual({ tripIds: [first.tripId], visitIds: [first.visitId], photoCount: 2, thumbnailSize: first.thumbnailSize });
});
