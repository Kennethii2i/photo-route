import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Thumbnail } from '../../src/domain/model';

for (const count of [1000, 5000]) {
  test(`${count} Photos and thumbnails stream to a local file and restore all semantic records`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto('/');
    const fixture = Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp'));
    const result = await page.evaluate(async ({ count, fixture }) => {
      const { newTrip, photoSchema, validateRelations } = await import('../../src/domain/model');
      const { newVisit } = await import('../../src/domain/visits');
      const { manualGpsCorrection, manualTimeCorrection } = await import('../../src/domain/corrections');
      const { sourceClockEvidence } = await import('../../src/domain/time');
      const { inspectImage } = await import('../../src/infrastructure/image');
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const { streamArchive, restoreArchive, verifyExportArchive } = await import('../../src/infrastructure/archive');
      const thumbBytes = new Uint8Array(fixture), dimensions = inspectImage(thumbBytes);
      const thumbnailBlob = new Blob([thumbBytes], { type: 'image/webp' });
      const firstTrip = newTrip('Synthetic active Trip'), originalSecond = newTrip('Synthetic trashed Trip');
      const secondTrip = { ...originalSecond, deletedAt: originalSecond.createdAt };
      const firstVisit = newVisit(firstTrip.id, 'First Visit', null, { latitude: 32.73, longitude: 129.87 });
      const originalSecondVisit = newVisit(secondTrip.id, 'Trashed Visit', null, { latitude: 35.68, longitude: 139.76 });
      const secondVisit = { ...originalSecondVisit, deletedAt: originalSecondVisit.createdAt };
      const photos: Array<ReturnType<typeof photoSchema.parse>> = [], thumbnails: Thumbnail[] = [];
      for (let index = 0; index < count; index++) {
        const id = crypto.randomUUID(), thumbId = crypto.randomUUID();
        const tripId = index < count * 0.8 ? firstTrip.id : secondTrip.id;
        const point = { latitude: 32.73 + index * 0.000001, longitude: 129.87 + index * 0.000001 };
        const sourceGps = index % 3 === 2
          ? { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing' as const, issues: [] }
          : { rawTags: { GPSLatitude: [32, 43, 48], GPSLongitude: [129, 52, 12], GPSMapDatum: index % 3 === 0 ? 'WGS-84' : null },
            normalized: point, horizontalErrorMeters: 2.19, datum: index % 3 === 0 ? 'WGS-84' : null,
            status: index % 3 === 0 ? 'valid' as const : 'suspect' as const, issues: index % 3 === 0 ? [] : ['測地系不明'] };
        const rawDateTimeOriginal = index % 2 === 0 ? '2020:02:03 04:05:06' : null;
        const rawOffsetTimeOriginal = index % 4 === 0 ? '+09:00' : null;
        const clock = sourceClockEvidence(rawDateTimeOriginal, rawOffsetTimeOriginal);
        photos.push(photoSchema.parse({ id, tripId, visitId: null,
          originalFilename: `synthetic-${index}.webp`, sourceMime: 'image/webp', sourceByteLength: thumbBytes.length,
          contentSha256: index.toString(16).padStart(64, '0'), sourceGps,
          gpsCorrection: index === 0 ? manualGpsCorrection(32.731, 129.871) : null,
          sourceTime: { rawDateTimeOriginal, rawOffsetTimeOriginal, rawGpsDateStamp: null, rawGpsTimeStamp: null, ...clock, issues: [] },
          timeCorrection: index === 0 ? manualTimeCorrection('2020:02:04 05:06:07', '+09:00') : null,
          sourceOrientation: index === 0 ? 6 : null, thumbnailId: thumbId, thumbnailState: 'available', metadataIssues: [],
          importedAt: firstTrip.createdAt, updatedAt: firstTrip.createdAt, deletedAt: index === 1 ? firstTrip.createdAt : null }));
        thumbnails.push({ id: thumbId, photoId: id, mime: 'image/webp' as const, width: dimensions.width!, height: dimensions.height!,
          byteLength: thumbBytes.length, blob: thumbnailBlob });
      }
      const links = [{ albumId: firstVisit.id, photoId: photos[0]!.id, createdAt: null },
        { albumId: secondVisit.id, photoId: photos[count - 1]!.id, createdAt: null }];
      const snapshot = { trips: [firstTrip, secondTrip], visits: [firstVisit, secondVisit], photos, thumbnails, links };
      validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(`phase4b-${count}-${crypto.randomUUID()}.zip`, { create: true });
      const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
      const heapBefore = heap(); let peak = heapBefore ?? 0, phase: 'export' | 'verify' | 'restore' = 'export';
      const phasePeaks = { export: peak, verify: 0, restore: 0 };
      const timer = window.setInterval(() => {
        const current = heap() ?? 0; peak = Math.max(peak, current); phasePeaks[phase] = Math.max(phasePeaks[phase], current);
      }, 20);
      const start = performance.now();
      const written = await streamArchive(snapshot, await handle.createWritable());
      const exportMs = Math.round(performance.now() - start);
      const file = await handle.getFile();
      phase = 'verify';
      await verifyExportArchive(snapshot, file);
      const verifiedMs = Math.round(performance.now() - start);
      phase = 'restore';
      const db = await LibraryDb.open(`phase4b-restore-${crypto.randomUUID()}`);
      const restoreResult = await restoreArchive(db, file);
      const restored = await db.snapshot(); db.close(); window.clearInterval(timer);
      validateRelations(restored.trips, restored.visits, restored.photos, restored.thumbnails);
      const first = restored.photos.find(photo => photo.id === photos[0]!.id)!;
      const last = restored.photos.find(photo => photo.id === photos[count - 1]!.id)!;
      const sourceIds = {
        trips: new Set(snapshot.trips.map(item => item.id)), visits: new Set(snapshot.visits.map(item => item.id)),
        photos: new Set(photos.map(item => item.id)), thumbnails: new Set(thumbnails.map(item => item.id)),
      };
      return { count, written, fileBytes: file.size, exportMs, verifiedMs, totalMs: Math.round(performance.now() - start),
        heapBefore, heapPeakSampled: peak, phasePeaks, heapAfter: heap(), restoredPhotos: restored.photos.length,
        restoredThumbnails: restored.thumbnails.length, restoredTrips: restored.trips.length, restoredVisits: restored.visits.length,
        firstSourceGps: first.sourceGps, firstSourceTime: first.sourceTime, firstCorrection: first.gpsCorrection,
        firstTimeCorrection: first.timeCorrection, firstVisitLink: restored.links?.some(link => link.photoId === first.id && link.albumId === firstVisit.id),
        lastVisitLink: restored.links?.some(link => link.photoId === last.id && link.albumId === secondVisit.id), trashedTrip: Boolean(restored.trips.find(trip => trip.id === secondTrip.id)?.deletedAt),
        trashedVisit: Boolean(restored.visits.find(visit => visit.id === secondVisit.id)?.deletedAt),
        trashedPhoto: Boolean(restored.photos.find(photo => photo.id === photos[1]!.id)?.deletedAt),
        state: restoreResult.state,
        allIds: restored.trips.every(item => sourceIds.trips.has(item.id)) && restored.visits.every(item => sourceIds.visits.has(item.id))
          && restored.photos.every(item => sourceIds.photos.has(item.id)) && restored.thumbnails.every(item => sourceIds.thumbnails.has(item.id)) };
    }, { count, fixture });
    console.log(`phase4b-${count}`, JSON.stringify({ ...result, firstSourceGps: result.firstSourceGps.status,
      firstSourceTime: result.firstSourceTime.status, firstCorrection: Boolean(result.firstCorrection), firstTimeCorrection: Boolean(result.firstTimeCorrection) }));
    expect(result).toMatchObject({ count, restoredPhotos: count, restoredThumbnails: count, restoredTrips: 2, restoredVisits: 2,
      firstVisitLink: true, lastVisitLink: true, trashedTrip: true, trashedVisit: true, trashedPhoto: true,
      state: 'imported', allIds: true });
    expect(result.firstSourceGps.status).toBe('valid');
    expect(result.firstSourceTime.status).toBe('utc-derived');
    expect(result.firstCorrection).not.toBeNull();
    expect(result.firstTimeCorrection).not.toBeNull();
    expect(result.written).toBe(result.fileBytes);
  });
}

test('a 5,000-thumbnail archive larger than the buffered limit streams to local storage and restores', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive, restoreArchive, streamArchive, MAX_BUFFERED_ARCHIVE_BYTES } = await import('../../src/infrastructure/archive');
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext('2d')!, image = context.createImageData(256, 256);
    let seed = 456789123;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      image.data[offset] = seed & 255; image.data[offset + 1] = (seed >>> 8) & 255;
      image.data[offset + 2] = (seed >>> 16) & 255; image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const thumbnailBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encode failed')), 'image/jpeg', 0.45));
    const trip = newTrip('Large synthetic backup');
    const photos: Array<ReturnType<typeof photoSchema.parse>> = [], thumbnails: Thumbnail[] = [];
    for (let index = 0; index < 5000; index++) {
      const id = crypto.randomUUID(), thumbnailId = crypto.randomUUID();
      photos.push(photoSchema.parse({ id, tripId: trip.id, visitId: null, originalFilename: `large-${index}.jpg`,
        sourceMime: 'image/jpeg', sourceByteLength: thumbnailBlob.size, contentSha256: index.toString(16).padStart(64, '0'),
        sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
        gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null,
          rawGpsTimeStamp: null, localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
        timeCorrection: null, sourceOrientation: null, thumbnailId, thumbnailState: 'available', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null }));
      thumbnails.push({ id: thumbnailId, photoId: id, mime: 'image/jpeg', width: 256, height: 256,
        byteLength: thumbnailBlob.size, blob: thumbnailBlob });
    }
    const snapshot = { trips: [trip], visits: [], photos, thumbnails, links: [] };
    let bufferedRejected = false;
    try { await exportArchive(snapshot); } catch { bufferedRejected = true; }
    const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const before = heap(); let peak = before ?? 0, phase: 'export' | 'restore' = 'export';
    const peaks = { export: peak, restore: 0 };
    const timer = window.setInterval(() => { const current = heap() ?? 0; peak = Math.max(peak, current); peaks[phase] = Math.max(peaks[phase], current); }, 20);
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(`phase4b-large-${crypto.randomUUID()}.zip`, { create: true });
    const started = performance.now();
    const bytes = await streamArchive(snapshot, await handle.createWritable());
    const exportMs = Math.round(performance.now() - started); phase = 'restore';
    const db = await LibraryDb.open(`phase4b-large-restore-${crypto.randomUUID()}`);
    const restored = await restoreArchive(db, await handle.getFile());
    const saved = await db.snapshot(); db.close(); window.clearInterval(timer);
    return { thumbnailBytes: thumbnailBlob.size, zipBytes: bytes, bufferedLimit: MAX_BUFFERED_ARCHIVE_BYTES,
      bufferedRejected, exportMs, totalMs: Math.round(performance.now() - started),
      heapBefore: before, heapPeakSampled: peak, peaks, heapAfter: heap(),
      restoredPhotos: restored.photos, savedThumbnails: saved.thumbnails.length };
  });
  console.log('phase4b-large-payload', JSON.stringify(result));
  expect(result.bufferedRejected).toBe(true);
  expect(result.zipBytes).toBeGreaterThan(result.bufferedLimit);
  expect(result).toMatchObject({ restoredPhotos: 5000, savedThumbnails: 5000 });
});
