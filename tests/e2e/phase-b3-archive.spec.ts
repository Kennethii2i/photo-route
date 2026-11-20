import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import type { PhotoAlbumLink, Thumbnail } from '../../src/domain/model';

async function isolated(page: Page): Promise<void> {
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
}

test('ZIP v2 round trip, link-only conflict, copy remapping and failure rollback', async ({ page }) => {
  await isolated(page);
  const fixture = Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp'));
  const result = await page.evaluate(async ({ fixture }) => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive, inspectArchive, previewArchiveRestore, restoreArchive } = await import('../../src/infrastructure/archive');
    const { inspectImage } = await import('../../src/infrastructure/image');
    const ids = await seedAlbumDb(4, 256);
    const source = await LibraryDb.open(ids.name);
    await source.saveAlbumMembershipBatch(await membershipRequest(source, ids.tripId, {
      [ids.photoIds[0]!]: ids.albumIds.slice(0, 3), [ids.photoIds[1]!]: [ids.albumIds[1]!],
    }));
    const thumbnailBytes = new Uint8Array(fixture), thumbnailDimensions = inspectImage(thumbnailBytes);
    const thumbnailId = crypto.randomUUID();
    const originalPhoto = (await source.listPhotos()).find(photo => photo.id === ids.photoIds[0])!;
    const trashed = { albumId: ids.albumIds[3]!, photoId: ids.photoIds[2]!, createdAt: null };
    const sourceIdb = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { sourceIdb.onsuccess = () => resolve(sourceIdb.result); sourceIdb.onerror = () => reject(sourceIdb.error); });
    const rawTx = raw.transaction(['photoAlbumLinks', 'photos', 'thumbnails'], 'readwrite'); rawTx.objectStore('photoAlbumLinks').add(trashed);
    rawTx.objectStore('photos').put({ ...originalPhoto, thumbnailId, thumbnailState: 'available' });
    rawTx.objectStore('thumbnails').add({ id: thumbnailId, photoId: originalPhoto.id, mime: 'image/webp',
      width: thumbnailDimensions.width, height: thumbnailDimensions.height, byteLength: thumbnailBytes.length,
      blob: new Blob([thumbnailBytes], { type: 'image/webp' }) });
    await new Promise<void>((resolve, reject) => { rawTx.oncomplete = () => resolve(); rawTx.onabort = () => reject(rawTx.error); }); raw.close();
    const complete = await source.snapshot();
    const blob = await exportArchive(complete);
    const inspected = await inspectArchive(blob);
    const target = await LibraryDb.open(`phase-b3-target-${crypto.randomUUID()}`);
    const imported = await restoreArchive(target, blob);
    const restored = await target.snapshot();
    const sameThumb = Array.from(new Uint8Array(await restored.thumbnails[0]!.blob.arrayBuffer())).join(',') === fixture.join(',');
    const history = await target.listRecovery();
    const same = JSON.stringify({ ...complete, links: [...complete.links!].sort((a, b) => a.albumId.localeCompare(b.albumId) || a.photoId.localeCompare(b.photoId)) })
      === JSON.stringify({ ...restored, links: [...restored.links!].sort((a, b) => a.albumId.localeCompare(b.albumId) || a.photoId.localeCompare(b.photoId)) });
    const identical = await restoreArchive(target, blob);
    await target.saveAlbumMembershipBatch(await membershipRequest(target, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[0]!] }));
    const preview = await previewArchiveRestore(target, blob);
    let conflict = '';
    try { await restoreArchive(target, blob); } catch (error) { conflict = (error as Error).message; }
    const beforeCopy = await target.snapshot();
    const copy = await restoreArchive(target, blob, 'copy-conflicts');
    const afterCopy = await target.snapshot();
    const copiedTrip = afterCopy.trips.find(trip => trip.name.endsWith('（復元コピー）'))!;
    const copiedPhotos = afterCopy.photos.filter(photo => photo.tripId === copiedTrip.id);
    const copiedAlbums = new Set(afterCopy.visits.filter(album => album.tripId === copiedTrip.id).map(album => album.id));
    const copiedPhotoIds = new Set(copiedPhotos.map(photo => photo.id));
    const copiedLinks = afterCopy.links!.filter(link => copiedPhotoIds.has(link.photoId));
    const copiedReferences = copiedLinks.every(link => copiedAlbums.has(link.albumId));
    const originalUnchanged = beforeCopy.links!.every(link => afterCopy.links!.some(after => JSON.stringify(after) === JSON.stringify(link)));
    const failed = await LibraryDb.open(`phase-b3-failure-${crypto.randomUUID()}`);
    const originalAdd = IDBObjectStore.prototype.add;
    const failures: string[] = [];
    for (const storeName of ['trips', 'visits', 'photos', 'thumbnails', 'photoAlbumLinks']) {
      IDBObjectStore.prototype.add = function (value, key) {
        if (this.name === storeName) throw new DOMException('synthetic quota failure', 'QuotaExceededError');
        return originalAdd.call(this, value, key);
      };
      try { await restoreArchive(failed, blob); failures.push('unexpected-success'); }
      catch (error) { failures.push((error as Error).name); }
      finally { IDBObjectStore.prototype.add = originalAdd; }
    }
    const afterFailures = await failed.snapshot();
    const originalHistory = (await source.listRecovery()).length;
    source.close(); target.close(); failed.close();
    return { inspectedLinks: inspected.links?.length, imported, same, sameThumb, history: history.length, identical, preview,
      conflict, copy, copiedPhotos: copiedPhotos.length, copiedLinks: copiedLinks.length, copiedReferences, originalUnchanged,
      failures, emptyAfterFailures: afterFailures.trips.length === 0 && afterFailures.visits.length === 0
        && afterFailures.photos.length === 0 && afterFailures.thumbnails.length === 0 && afterFailures.links?.length === 0,
      photo0Links: restored.links!.filter(link => link.photoId === ids.photoIds[0]).length,
      trashLink: restored.links!.some(link => link.albumId === trashed.albumId && link.photoId === trashed.photoId && link.createdAt === null),
      originalHistory,
    };
  }, { fixture });
  expect(result).toMatchObject({ inspectedLinks: 5, imported: { state: 'imported', trips: 2, photos: 4 }, same: true, sameThumb: true,
    history: 0, identical: { state: 'skipped-identical' }, preview: { conflictingTrips: 1 },
    copy: { state: 'imported', trips: 1, photos: 4 }, copiedPhotos: 4, copiedLinks: 5,
    copiedReferences: true, originalUnchanged: true, failures: Array(5).fill('QuotaExceededError'),
    emptyAfterFailures: true, photo0Links: 3, trashLink: true, originalHistory: 1 });
  expect(result.conflict).toContain('既存データは変更しません');
});

test('genuine ZIP v1 restores a single migrated album link into v3 without fabricated timestamp', async ({ page }) => {
  await isolated(page);
  const generated = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive } = await import('../../src/infrastructure/archive');
    const ids = await seedAlbumDb(1, 256);
    const db = await LibraryDb.open(ids.name);
    await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[0]!] }));
    const bytes = Array.from(new Uint8Array(await (await exportArchive(await db.snapshot())).arrayBuffer()));
    db.close();
    return { bytes, photoId: ids.photoIds[0], albumId: ids.albumIds[0] };
  });
  const entries = unzipSync(new Uint8Array(generated.bytes));
  delete entries['records/photo-album-links.json'];
  const photos = JSON.parse(new TextDecoder().decode(entries['records/photos.json']!)) as Array<{ id: string; visitId: string | null }>;
  photos.find(photo => photo.id === generated.photoId)!.visitId = generated.albumId!;
  const photoBytes = new TextEncoder().encode(JSON.stringify(photos));
  entries['records/photos.json'] = photoBytes;
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as { version: number; entries: Array<{ path: string; size: number; sha256: string }> };
  manifest.version = 1;
  manifest.entries = manifest.entries.filter(entry => entry.path !== 'records/photo-album-links.json');
  const photoEntry = manifest.entries.find(entry => entry.path === 'records/photos.json')!;
  photoEntry.size = photoBytes.length; photoEntry.sha256 = createHash('sha256').update(photoBytes).digest('hex');
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  const v1Bytes = Array.from(zipSync(entries));
  const result = await page.evaluate(async ({ v1Bytes, photoId, albumId }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { inspectArchive, restoreArchive } = await import('../../src/infrastructure/archive');
    const blob = new Blob([new Uint8Array(v1Bytes)], { type: 'application/zip' });
    const inspected = await inspectArchive(blob);
    const db = await LibraryDb.open(`phase-b3-v1-${crypto.randomUUID()}`);
    const restored = await restoreArchive(db, blob);
    const repeated = await restoreArchive(db, blob);
    const snapshot = await db.snapshot(); db.close();
    return { restored, repeated, link: snapshot.links?.find(link => link.photoId === photoId),
      visitId: snapshot.photos.find(photo => photo.id === photoId)?.visitId,
      exif: snapshot.photos.find(photo => photo.id === photoId)?.sourceGps.rawTags.Synthetic,
      inspectedLinks: inspected.links?.length, albumId };
  }, { v1Bytes, photoId: generated.photoId, albumId: generated.albumId });
  expect(result).toMatchObject({ restored: { state: 'imported' }, repeated: { state: 'skipped-identical' }, inspectedLinks: 1, visitId: null,
    exif: 'x'.repeat(256), link: { albumId: generated.albumId, photoId: generated.photoId, createdAt: null } });
});

test('Photo, album edit and trash conflicts reject ZIP v2 without changing existing records', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive, previewArchiveRestore, restoreArchive } = await import('../../src/infrastructure/archive');
    const ids = await seedAlbumDb(1);
    const source = await LibraryDb.open(ids.name);
    const blob = await exportArchive(await source.snapshot()); source.close();
    const results = [];
    for (const mode of ['photo', 'album', 'trash'] as const) {
      const db = await LibraryDb.open(`phase-b3-conflict-${mode}-${crypto.randomUUID()}`);
      await restoreArchive(db, blob);
      if (mode === 'photo') await db.updatePhotoCorrection(ids.photoIds[0]!, {
        gpsCorrection: { value: { latitude: 35, longitude: 139 }, correctedAt: new Date().toISOString(), source: 'manual' },
      });
      if (mode === 'album') {
        const album = (await db.listVisits()).find(item => item.id === ids.albumIds[0])!;
        await db.updateVisit({ ...album, label: 'Changed', updatedAt: new Date().toISOString() });
      }
      if (mode === 'trash') await db.moveToTrash('visit', ids.albumIds[0]!);
      const before = JSON.stringify(await db.snapshot());
      const preview = await previewArchiveRestore(db, blob);
      let error = '';
      try { await restoreArchive(db, blob); } catch (caught) { error = (caught as Error).message; }
      const unchanged = before === JSON.stringify(await db.snapshot()); db.close();
      results.push({ mode, conflictingTrips: preview.conflictingTrips, error, unchanged });
    }
    return results;
  });
  expect(result.map(item => item.conflictingTrips)).toEqual([1, 1, 1]);
  expect(result.every(item => item.error.includes('既存データは変更しません') && item.unchanged)).toBe(true);
});

for (const count of [100, 1000, 5000]) {
  test(`${count} synthetic photos with three album links each stream and restore ZIP v2`, async ({ page }) => {
    test.setTimeout(600_000);
    await isolated(page);
    const fixture = Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp'));
    const result = await page.evaluate(async ({ count, fixture }) => {
      const { newTrip, photoSchema } = await import('../../src/domain/model');
      const { newVisit } = await import('../../src/domain/visits');
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const { streamArchive, restoreArchive, verifyExportArchive } = await import('../../src/infrastructure/archive');
      const { inspectImage } = await import('../../src/infrastructure/image');
      const trip = newTrip('Synthetic B3 Trip');
      const albums = ['A', 'B', 'C', 'Empty'].map(label => newVisit(trip.id, label));
      let bytes = new Uint8Array(fixture);
      let thumbnailMime: 'image/webp' | 'image/jpeg' = 'image/webp';
      if (count === 5000) {
        // A deterministic, valid, camera-like thumbnail capacity case (not a real photo).
        const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 300;
        const context = canvas.getContext('2d')!, pixels = context.createImageData(300, 300);
        let state = 1;
        for (let index = 0; index < pixels.data.length; index += 4) {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          pixels.data[index] = state & 255; pixels.data[index + 1] = (state >>> 8) & 255;
          pixels.data[index + 2] = (state >>> 16) & 255; pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        const generated = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('thumbnail generation failed')), 'image/jpeg', 0.68));
        bytes = new Uint8Array(await generated.arrayBuffer()); thumbnailMime = 'image/jpeg';
      }
      const dimensions = inspectImage(bytes);
      const thumb = new Blob([bytes], { type: thumbnailMime });
      const photos: Array<ReturnType<typeof photoSchema.parse>> = [], thumbnails: Thumbnail[] = [], links: PhotoAlbumLink[] = [];
      for (let index = 0; index < count; index++) {
        const id = crypto.randomUUID(), thumbId = crypto.randomUUID();
        photos.push(photoSchema.parse({ id, tripId: trip.id, visitId: null, originalFilename: `synthetic-${index}.webp`,
          sourceMime: 'image/webp', sourceByteLength: bytes.length, contentSha256: index.toString(16).padStart(64, '0'),
          sourceGps: { rawTags: { Synthetic: 'x'.repeat(256) }, normalized: null, horizontalErrorMeters: null, datum: null,
            status: 'missing', issues: [] }, gpsCorrection: null,
          sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
            localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
          timeCorrection: null, sourceOrientation: null, thumbnailId: thumbId, thumbnailState: 'available',
          metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null }));
        thumbnails.push({ id: thumbId, photoId: id, mime: thumbnailMime, width: dimensions.width!,
          height: dimensions.height!, byteLength: bytes.length, blob: thumb });
        for (const album of albums.slice(0, 3)) links.push({ albumId: album.id, photoId: id, createdAt: index === 0 ? null : trip.createdAt });
      }
      const snapshot = { trips: [trip], visits: albums, photos, thumbnails, links };
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(`phase-b3-${count}-${crypto.randomUUID()}.zip`, { create: true });
      const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
      const beforeHeap = heap(); let peakHeap = beforeHeap ?? 0;
      const timer = window.setInterval(() => { peakHeap = Math.max(peakHeap, heap() ?? 0); }, 20);
      const start = performance.now();
      const written = await streamArchive(snapshot, await handle.createWritable());
      const exportMs = Math.round(performance.now() - start);
      const file = await handle.getFile();
      await verifyExportArchive(snapshot, file);
      const db = await LibraryDb.open(`phase-b3-scale-${crypto.randomUUID()}`);
      const restoreStart = performance.now();
      await restoreArchive(db, file);
      const restoreMs = Math.round(performance.now() - restoreStart);
      const restored = await db.snapshot(); db.close();
      window.clearInterval(timer);
      await root.removeEntry(handle.name);
      return { count, written, exportMs, restoreMs, thumbnailBytes: bytes.length, beforeHeap, peakHeap, afterHeap: heap(),
        restoredPhotos: restored.photos.length, restoredThumbnails: restored.thumbnails.length,
        restoredLinks: restored.links?.length, emptyAlbum: restored.links?.every(link => link.albumId !== albums[3]!.id),
        firstExif: restored.photos[0]!.sourceGps.rawTags.Synthetic, firstCreatedAt: restored.links?.find(link => link.photoId === photos[0]!.id)?.createdAt };
    }, { count, fixture });
    console.log(`phase-b3-scale-${count}`, JSON.stringify({ ...result, firstExif: String(result.firstExif).length }));
    expect(result).toMatchObject({ count, restoredPhotos: count, restoredThumbnails: count,
      restoredLinks: count * 3, emptyAlbum: true, firstCreatedAt: null });
    expect(result.firstExif).toBe('x'.repeat(256));
  });
}
