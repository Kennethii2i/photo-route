import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('v1 IndexedDB upgrades without rewriting records; snapshots allow durable Undo and quota failure rolls back', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async thumbnailBytes => {
    const modelUrl = '/src/domain/model.ts', storageUrl = '/src/infrastructure/storage.ts', visitsUrl = '/src/domain/visits.ts', imageUrl = '/src/infrastructure/image.ts';
    const { newTrip, photoSchema } = await import(modelUrl) as typeof import('../../src/domain/model');
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { newVisit } = await import(visitsUrl) as typeof import('../../src/domain/visits');
    const { inspectImage } = await import(imageUrl) as typeof import('../../src/infrastructure/image');
    const name = `phase2c-legacy-${crypto.randomUUID()}`;
    const trip = newTrip('旧バージョンの旅行');
    const visit = newVisit(trip.id, '旧Visit');
    const photoId = crypto.randomUUID(), thumbId = crypto.randomUUID();
    const photo = photoSchema.parse({ id: photoId, tripId: trip.id, visitId: visit.id, originalFilename: 'legacy.jpg',
      sourceMime: 'image/jpeg', sourceByteLength: 1, contentSha256: 'a'.repeat(64),
      sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
      gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
        localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, thumbnailId: thumbId, thumbnailState: 'available', metadataIssues: [],
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null });
    const image = inspectImage(new Uint8Array(thumbnailBytes));
    const thumbnail = { id: thumbId, photoId, mime: 'image/webp', width: image.width!, height: image.height!,
      byteLength: thumbnailBytes.length, blob: new Blob([new Uint8Array(thumbnailBytes)], { type: 'image/webp' }) };
    const opened = indexedDB.open(name, 1);
    opened.onupgradeneeded = () => {
      const db = opened.result;
      db.createObjectStore('trips', { keyPath: 'id' });
      const photos = db.createObjectStore('photos', { keyPath: 'id' });
      photos.createIndex('byHash', 'contentSha256'); photos.createIndex('byTrip', 'tripId');
      db.createObjectStore('visits', { keyPath: 'id' }).createIndex('byTrip', 'tripId');
      db.createObjectStore('thumbnails', { keyPath: 'id' }); db.createObjectStore('jobs', { keyPath: 'id' });
    };
    const oldDb = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const oldTx = oldDb.transaction(['trips', 'visits', 'photos', 'thumbnails'], 'readwrite');
    oldTx.objectStore('trips').add(trip); oldTx.objectStore('visits').add(visit);
    oldTx.objectStore('photos').add(photo); oldTx.objectStore('thumbnails').add(thumbnail);
    await new Promise<void>((resolve, reject) => { oldTx.oncomplete = () => resolve(); oldTx.onabort = () => reject(oldTx.error); });
    oldDb.close();
    let db = await LibraryDb.open(name);
    const migrated = await db.getTrip(trip.id);
    const migratedSnapshot = await db.snapshot();
    const initialRecovery = await db.listRecovery();
    await db.moveToTrash('trip', trip.id);
    const trashed = await db.getTrip(trip.id);
    const historyEntry = (await db.listRecovery())[0];
    const firstEntry = historyEntry?.kind === 'trip' || historyEntry?.kind === 'visit' || historyEntry?.kind === 'photo' ? historyEntry : undefined;
    db.close(); db = await LibraryDb.open(name);
    const durableCount = (await db.listRecovery()).length;
    await db.restoreFromTrash('trip', trip.id);
    await db.undoLatest();
    const afterUndoRestore = await db.getTrip(trip.id);
    await db.undoLatest();
    const afterUndoDelete = await db.getTrip(trip.id);
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
      if (this.name === 'recovery') throw new DOMException('quota', 'QuotaExceededError');
      return originalAdd.call(this, value, key);
    };
    let quotaRejected = false, quotaLinkRejected = false;
    try { await db.moveToTrash('trip', trip.id); } catch { quotaRejected = true; }
    try { await db.setPhotoVisit(photoId, null); } catch { quotaLinkRejected = true; }
    finally { IDBObjectStore.prototype.add = originalAdd; }
    const afterQuota = await db.getTrip(trip.id);
    const afterLinkQuota = (await db.listPhotos()).find(item => item.id === photoId)?.visitId;
    const recoveryCount = (await db.listRecovery()).length;
    await db.moveToTrash('trip', trip.id);
    const raw = indexedDB.open(name, 3);
    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => { raw.onsuccess = () => resolve(raw.result); raw.onerror = () => reject(raw.error); });
    const current = await db.getTrip(trip.id);
    const rawTx = rawDb.transaction('trips', 'readwrite');
    rawTx.objectStore('trips').put({ ...current, name: 'Later change' });
    await new Promise<void>((resolve, reject) => { rawTx.oncomplete = () => resolve(); rawTx.onabort = () => reject(rawTx.error); });
    rawDb.close();
    let staleUndoRejected = false;
    try { await db.undoLatest(); } catch { staleUndoRejected = true; }
    const afterStale = await db.getTrip(trip.id);
    db.close();
    return { migrated, migratedLinks: { photo: migratedSnapshot.photos[0], visit: migratedSnapshot.visits[0], link: migratedSnapshot.links[0], thumb: { id: migratedSnapshot.thumbnails[0]?.id, photoId: migratedSnapshot.thumbnails[0]?.photoId, bytes: migratedSnapshot.thumbnails[0]?.blob.size } }, initialRecovery: initialRecovery.length, trashed: Boolean(trashed?.deletedAt), durableCount,
      snapshotBefore: firstEntry?.before, snapshotAfterDeleted: Boolean(firstEntry?.after.deletedAt),
      afterUndoRestore: Boolean(afterUndoRestore?.deletedAt), afterUndoDelete, quotaRejected, quotaLinkRejected, afterQuota, afterLinkQuota, recoveryCount, staleUndoRejected, afterStale };
  }, Array.from(readFileSync('fixtures/generated/webp_no_metadata.webp')));
  expect(result.migrated?.name).toBe('旧バージョンの旅行');
  expect(result.migrated?.deletedAt).toBeNull();
  expect(result.migratedLinks.photo?.visitId).toBeNull();
  expect(result.migratedLinks.link).toMatchObject({ albumId: result.migratedLinks.visit?.id, photoId: result.migratedLinks.photo?.id, createdAt: null });
  expect(result.migratedLinks.photo?.thumbnailId).toBe(result.migratedLinks.thumb.id);
  expect(result.migratedLinks.thumb.photoId).toBe(result.migratedLinks.photo?.id);
  expect(result.migratedLinks.thumb.bytes).toBeGreaterThan(0);
  expect(result.initialRecovery).toBe(0);
  expect(result.trashed).toBe(true);
  expect(result.snapshotBefore).toEqual(result.migrated);
  expect(result.snapshotAfterDeleted).toBe(true);
  expect(result.durableCount).toBe(1);
  expect(result.afterUndoRestore).toBe(true);
  expect(result.afterUndoDelete).toEqual(result.migrated);
  expect(result.quotaRejected).toBe(true);
  expect(result.quotaLinkRejected).toBe(true);
  expect(result.afterQuota).toEqual(result.migrated);
  expect(result.afterLinkQuota).toBeNull();
  expect(result.recoveryCount).toBe(2);
  expect(result.staleUndoRejected).toBe(true);
  expect(result.afterStale?.name).toBe('Later change');
  expect(result.afterStale?.deletedAt).not.toBeNull();
});

test('Photo, album and Trip trash and restore retain v3 links and thumbnails', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(1, 128, true), db = await LibraryDb.open(ids.name);
    await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId,
      { [ids.photoIds[0]!]: [ids.albumIds[0]!, ids.albumIds[1]!] }));
    const before = await db.snapshot();
    for (const [kind, id] of [['photo', ids.photoIds[0]!], ['visit', ids.albumIds[0]!], ['trip', ids.tripId]] as const)
      await db.moveToTrash(kind, id);
    const trashed = await db.snapshot();
    for (const [kind, id] of [['trip', ids.tripId], ['visit', ids.albumIds[0]!], ['photo', ids.photoIds[0]!]] as const)
      await db.restoreFromTrash(kind, id);
    const after = await db.snapshot(); db.close();
    return {
      trashed: [trashed.photos[0]?.deletedAt, trashed.visits.find(album => album.id === ids.albumIds[0])?.deletedAt,
        trashed.trips.find(trip => trip.id === ids.tripId)?.deletedAt].every(Boolean),
      linksBefore: before.links, linksTrashed: trashed.links, linksAfter: after.links,
      thumbnailBefore: before.thumbnails[0]?.blob.size, thumbnailAfter: after.thumbnails[0]?.blob.size,
      activeAgain: [after.photos[0]?.deletedAt, after.visits.find(album => album.id === ids.albumIds[0])?.deletedAt,
        after.trips.find(trip => trip.id === ids.tripId)?.deletedAt].every(value => value === null),
    };
  });
  expect(result.trashed).toBe(true);
  expect(result.activeAgain).toBe(true);
  expect(result.linksTrashed).toEqual(result.linksBefore);
  expect(result.linksAfter).toEqual(result.linksBefore);
  expect(result.thumbnailBefore).toBeGreaterThan(0);
  expect(result.thumbnailAfter).toBe(result.thumbnailBefore);
});

test('ZIP v2 conflict rejects without mutation and copy remaps every membership ID', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive, restoreArchive } = await import('../../src/infrastructure/archive');
    const ids = await seedAlbumDb(2), source = await LibraryDb.open(ids.name);
    await source.saveAlbumMembershipBatch(await membershipRequest(source, ids.tripId,
      { [ids.photoIds[0]!]: [ids.albumIds[0]!, ids.albumIds[1]!] }));
    const zip = await exportArchive(await source.snapshot());
    const target = await LibraryDb.open(`phase2c-zip-${crypto.randomUUID()}`);
    await restoreArchive(target, zip);
    await target.moveToTrash('trip', ids.tripId);
    const before = await target.snapshot();
    let conflict = false;
    try { await restoreArchive(target, zip); } catch { conflict = true; }
    const unchanged = JSON.stringify((await target.snapshot()).links) === JSON.stringify(before.links);
    await restoreArchive(target, zip, 'copy-conflicts');
    const after = await target.snapshot();
    const copied = after.trips.find(trip => trip.name.endsWith('（復元コピー）'))!;
    const copiedPhotos = new Set(after.photos.filter(photo => photo.tripId === copied.id).map(photo => photo.id));
    const copiedAlbums = new Set(after.visits.filter(album => album.tripId === copied.id).map(album => album.id));
    const copiedLinks = after.links.filter(link => copiedPhotos.has(link.photoId));
    source.close(); target.close();
    return { conflict, unchanged, copiedLinks: copiedLinks.length,
      validCopy: copiedLinks.every(link => copiedAlbums.has(link.albumId)) };
  });
  expect(result).toEqual({ conflict: true, unchanged: true, copiedLinks: 2, validCopy: true });
});
