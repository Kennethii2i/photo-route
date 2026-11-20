import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('legacy 995-entry workload and its 996th thumbnail round-trip; malformed inputs are rejected', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const webp = Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp'));
  const measurements = await page.evaluate(async bytes => {
    const archiveUrl = '/src/infrastructure/archive.ts', modelUrl = '/src/domain/model.ts', imageUrl = '/src/infrastructure/image.ts', storageUrl = '/src/infrastructure/storage.ts';
    const { exportArchive, inspectArchive, restoreArchive, MAX_ARCHIVE_BYTES } = await import(archiveUrl) as typeof import('../../src/infrastructure/archive');
    const { newTrip, photoSchema } = await import(modelUrl) as typeof import('../../src/domain/model');
    const { inspectImage } = await import(imageUrl) as typeof import('../../src/infrastructure/image');
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const image = new Uint8Array(bytes), imageInfo = inspectImage(image), trip = newTrip('Scale trial');
    const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const photos = [], thumbnails = [];
    const results = [];
    for (let i = 0; i < 996; i++) {
      const id = crypto.randomUUID(), thumbId = crypto.randomUUID();
      photos.push(photoSchema.parse({ id, tripId: trip.id, visitId: null, originalFilename: `synthetic-${i}.webp`,
        sourceMime: 'image/webp', sourceByteLength: image.length, contentSha256: i.toString(16).padStart(64, '0'),
        sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
        gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
          localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
        timeCorrection: null, sourceOrientation: null, thumbnailId: thumbId, thumbnailState: 'available', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null }));
      thumbnails.push({ id: thumbId, photoId: id, mime: 'image/webp' as const, width: imageInfo.width!, height: imageInfo.height!,
        byteLength: image.length, blob: new Blob([image.slice()], { type: 'image/webp' }) });
    }
    for (const count of [100, 500, 995]) {
      const snapshot = { trips: [trip], visits: [], photos: photos.slice(0, count), thumbnails: thumbnails.slice(0, count), links: [] };
      const before = heap(), start = performance.now();
      const zip = await exportArchive(snapshot); const encodedMs = performance.now() - start;
      const parsed = await inspectArchive(zip); const totalMs = performance.now() - start;
      results.push({ count, zipBytes: zip.size, encodedMs: Math.round(encodedMs), totalMs: Math.round(totalMs),
        heapBefore: before, heapAfter: heap(), restoredPhotos: parsed.photos.length, restoredThumbnails: parsed.thumbnails.length });
    }
    const db = await LibraryDb.open(`phase2d-scale-${crypto.randomUUID()}`);
    await db.createTrip(trip); const beforeRestore = await db.snapshot();
    let inputRejected = false, expandedRejected = false;
    const extendedRoundTrip = (await inspectArchive(await exportArchive({ trips: [trip], visits: [], photos, thumbnails, links: [] }))).photos.length;
    const oversized = new Blob(); Object.defineProperty(oversized, 'size', { value: MAX_ARCHIVE_BYTES + 1 });
    try { await restoreArchive(db, oversized); } catch { inputRejected = true; }
    const smallZip = new Uint8Array(await (await exportArchive({ trips: [trip], visits: [], photos: photos.slice(0, 1), thumbnails: thumbnails.slice(0, 1), links: [] })).arrayBuffer());
    const view = new DataView(smallZip.buffer);
    for (let i = 0; i < smallZip.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 65 * 1024 * 1024, true); break; }
    }
    try { await restoreArchive(db, new Blob([smallZip])); } catch { expandedRejected = true; }
    const afterRestore = await db.snapshot(); db.close();
    return { results, extendedRoundTrip, inputRejected, expandedRejected,
      noMutation: JSON.stringify(beforeRestore.trips) === JSON.stringify(afterRestore.trips) && afterRestore.photos.length === 0 };
  }, webp);
  console.log('phase2d-zip-scale', JSON.stringify(measurements));
  expect(measurements.results.map(x => x.count)).toEqual([100, 500, 995]);
  expect(measurements.results.every(x => x.restoredPhotos === x.count && x.restoredThumbnails === x.count)).toBe(true);
  expect(measurements.extendedRoundTrip).toBe(996);
  expect(measurements.inputRejected).toBe(true);
  expect(measurements.expandedRejected).toBe(true);
  expect(measurements.noMutation).toBe(true);
});

test('ZIP with about 20 MiB of image payload measures browser processing cost', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const archiveUrl = '/src/infrastructure/archive.ts', modelUrl = '/src/domain/model.ts';
    const { exportArchive, inspectArchive } = await import(archiveUrl) as typeof import('../../src/infrastructure/archive');
    const { newTrip, photoSchema } = await import(modelUrl) as typeof import('../../src/domain/model');
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext('2d')!; const pixels = context.createImageData(512, 512);
    let seed = 123456789;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (1664525 * seed + 1013904223) >>> 0; pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >>> 8) & 255; pixels.data[i + 2] = (seed >>> 16) & 255; pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encode failed')), 'image/jpeg', 0.78));
    const count = Math.min(180, Math.floor(20 * 1024 * 1024 / image.size));
    const trip = newTrip('Payload trial'); const photos = [], thumbnails = [];
    for (let i = 0; i < count; i++) {
      const id = crypto.randomUUID(), thumbnailId = crypto.randomUUID();
      photos.push(photoSchema.parse({ id, tripId: trip.id, visitId: null, originalFilename: `synthetic-${i}.jpg`,
        sourceMime: 'image/jpeg', sourceByteLength: image.size, contentSha256: i.toString(16).padStart(64, '0'),
        sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
        gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
          localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
        timeCorrection: null, sourceOrientation: null, thumbnailId, thumbnailState: 'available', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null }));
      thumbnails.push({ id: thumbnailId, photoId: id, mime: 'image/jpeg' as const, width: 512, height: 512,
        byteLength: image.size, blob: image });
    }
    const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const before = heap(), start = performance.now();
    const zip = await exportArchive({ trips: [trip], visits: [], photos, thumbnails, links: [] }); const encodeMs = performance.now() - start;
    const restored = await inspectArchive(zip); const roundTripMs = performance.now() - start;
    return { count, thumbBytes: image.size, payloadBytes: image.size * count, zipBytes: zip.size,
      encodeMs: Math.round(encodeMs), roundTripMs: Math.round(roundTripMs), heapBefore: before, heapAfter: heap(),
      restoredPhotos: restored.photos.length, restoredThumbnails: restored.thumbnails.length };
  });
  console.log('phase2d-zip-payload', JSON.stringify(result));
  expect(result.payloadBytes).toBeGreaterThan(10 * 1024 * 1024);
  expect(result.zipBytes).toBeLessThan(32 * 1024 * 1024);
  expect(result.restoredPhotos).toBe(result.count);
  expect(result.restoredThumbnails).toBe(result.count);
});
