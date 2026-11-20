import { expect, test, type Page } from '@playwright/test';

type Seed = { name: string; tripId: string; visitId: string; photoId: string; original: unknown; history: unknown[] };

async function isolated(page: Page): Promise<void> {
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
}

async function seedV2(page: Page, options: { count?: number; invalid?: 'missing-visit' | 'cross-trip'; trash?: boolean } = {}): Promise<Seed> {
  return page.evaluate(async ({ count = 1, invalid, trash }) => {
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const name = `phase-b1-${crypto.randomUUID()}`;
    const trip = newTrip('合成旅行');
    const otherTrip = newTrip('別の合成旅行');
    const visit = newVisit(trip.id, '合成アルバム');
    if (trash) visit.deletedAt = new Date().toISOString();
    const emptyVisit = newVisit(trip.id, '空アルバム');
    const recovery = { id: crypto.randomUUID(), kind: 'visit', action: 'old history', targetId: visit.id,
      createdAt: trip.createdAt, before: visit, after: visit, undoneAt: null };
    const photo = (index: number) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: invalid === 'cross-trip' ? otherTrip.id : trip.id,
      visitId: invalid === 'missing-visit' ? crypto.randomUUID() : visit.id,
      originalFilename: `synthetic-${index}.jpg`, sourceMime: 'image/jpeg', sourceByteLength: 1000,
      contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: { Synthetic: `gps-${index}` }, normalized: null, horizontalErrorMeters: null,
        datum: null, status: 'missing', issues: [] },
      gpsCorrection: { value: { latitude: 35, longitude: 139 }, correctedAt: trip.createdAt, source: 'manual' },
      sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null,
        rawGpsTimeStamp: null, localClock: null, offsetMinutes: null, capturedAtUtc: null,
        status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: 6, thumbnailId: null, thumbnailState: 'failed',
      metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    });
    const first = photo(0);
    const batchRecovery = { id: crypto.randomUUID(), kind: 'photo-visit-batch', action: 'old batch',
      targetId: visit.id, createdAt: trip.createdAt,
      changes: [{ before: first, afterVisitId: visit.id, afterUpdatedAt: first.updatedAt }], undoneAt: null };
    const opened = indexedDB.open(name, 2);
    opened.onupgradeneeded = () => {
      const db = opened.result;
      db.createObjectStore('trips', { keyPath: 'id' });
      const photos = db.createObjectStore('photos', { keyPath: 'id' });
      photos.createIndex('byHash', 'contentSha256');
      photos.createIndex('byTrip', 'tripId');
      db.createObjectStore('visits', { keyPath: 'id' }).createIndex('byTrip', 'tripId');
      db.createObjectStore('thumbnails', { keyPath: 'id' });
      db.createObjectStore('jobs', { keyPath: 'id' });
      db.createObjectStore('recovery', { keyPath: 'sequence', autoIncrement: true });
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    const tx = db.transaction(['trips', 'visits', 'photos', 'recovery'], 'readwrite');
    tx.objectStore('trips').add(trip);
    if (invalid === 'cross-trip') tx.objectStore('trips').add(otherTrip);
    tx.objectStore('visits').add(visit);
    tx.objectStore('visits').add(emptyVisit);
    tx.objectStore('photos').add(first);
    for (let i = 1; i < count; i++) tx.objectStore('photos').add(photo(i));
    tx.objectStore('photos').add(photoSchema.parse({ ...photo(999_999), tripId: null, visitId: null,
      contentSha256: 'f'.repeat(64) }));
    tx.objectStore('recovery').add(recovery);
    tx.objectStore('recovery').add(batchRecovery);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    db.close();
    return { name, tripId: trip.id, visitId: visit.id, photoId: first.id, original: first, history: [recovery, batchRecovery] };
  }, options);
}

test('v3 creates an empty link store and preserves legacy history', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(`phase-b1-empty-${crypto.randomUUID()}`);
    const links = await db.listPhotoAlbumLinks();
    const history = await db.listRecovery();
    const undo = await db.latestUndoable();
    db.close();
    return { links, history, undo };
  });
  expect(result).toEqual({ links: [], history: [], undo: undefined });
});

test('v2 photos migrate once, including trashed album links, without changing source fields or recovery', async ({ page }) => {
  await isolated(page);
  const seed = await seedV2(page, { count: 3, trash: true });
  const result = await page.evaluate(async ({ name, photoId }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(name);
    const photos = await db.listPhotos();
    const visits = await db.listVisits();
    const links = await db.listPhotoAlbumLinks();
    const byPhoto = await db.listPhotoAlbumLinks(photoId);
    const history = await db.listRecovery();
    const undo = await db.latestUndoable();
    db.close();
    const reopened = await LibraryDb.open(name);
    const reopenedLinks = await reopened.listPhotoAlbumLinks();
    reopened.close();
    return { photos, visits, links, byPhoto, history, undo, reopenedLinks };
  }, seed);
  expect(result.links).toHaveLength(3);
  expect(result.reopenedLinks).toEqual(result.links);
  expect(result.byPhoto).toEqual([{ albumId: seed.visitId, photoId: seed.photoId, createdAt: null }]);
  expect(result.photos.find(photo => photo.id === seed.photoId)).toEqual({ ...(seed.original as object), visitId: null });
  expect(result.photos.filter(photo => photo.tripId === null)).toHaveLength(1);
  expect(result.visits.find(visit => visit.id === seed.visitId)?.deletedAt).not.toBeNull();
  expect(result.history).toEqual(seed.history.map((entry, index) => ({ ...(entry as object), sequence: index + 1 })));
  expect(result.undo?.kind).toBe('photo-visit-batch');
  await page.reload();
  const reopenedAfterReload = await page.evaluate(async name => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(name);
    const links = await db.listPhotoAlbumLinks();
    db.close();
    return links;
  }, seed.name);
  expect(reopenedAfterReload).toEqual(result.links);
});

test('compound key rejects the same photo and album link twice', async ({ page }) => {
  await isolated(page);
  const seed = await seedV2(page);
  const result = await page.evaluate(async name => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const library = await LibraryDb.open(name);
    const [link] = await library.listPhotoAlbumLinks();
    library.close();
    const opened = indexedDB.open(name, 3);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error);
    });
    const tx = db.transaction('photoAlbumLinks', 'readwrite');
    tx.objectStore('photoAlbumLinks').add(link!);
    const error = await new Promise<string>(resolve => {
      tx.onabort = () => resolve(tx.error?.name ?? 'AbortError');
    });
    db.close();
    const reopened = await LibraryDb.open(name);
    const count = (await reopened.listPhotoAlbumLinks()).length;
    reopened.close();
    return { error, count };
  }, seed.name);
  expect(result).toEqual({ error: 'ConstraintError', count: 1 });
});

for (const invalid of ['missing-visit', 'cross-trip'] as const) {
  test(`invalid ${invalid} aborts upgrade and leaves v2 unchanged`, async ({ page }) => {
    await isolated(page);
    const seed = await seedV2(page, { invalid });
    const result = await page.evaluate(async ({ name, photoId }) => {
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      let error = '';
      try { await LibraryDb.open(name); } catch (caught) { error = (caught as Error).message; }
      const opened = indexedDB.open(name, 2);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error);
      });
      const photo = await new Promise<{ visitId: string }>((resolve, reject) => {
        const get = db.transaction('photos').objectStore('photos').get(photoId);
        get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error);
      });
      const result = { error, version: db.version, stores: [...db.objectStoreNames], visitId: photo.visitId };
      db.close();
      return result;
    }, seed);
    expect(result.error).toContain('移行を中止');
    expect(result.version).toBe(2);
    expect(result.stores).not.toContain('photoAlbumLinks');
    expect(result.visitId).toBe((seed.original as { visitId: string }).visitId);
  });
}

for (const failure of ['quota', 'interruption'] as const) {
  test(`simulated ${failure} aborts all link and photo writes`, async ({ page }) => {
    await isolated(page);
    const seed = await seedV2(page, { count: 3 });
    const result = await page.evaluate(async ({ name, photoId, failure }) => {
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const originalAdd = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
        if (this.name === 'photoAlbumLinks') {
          if (failure === 'interruption') this.transaction.abort();
          throw new DOMException('synthetic failure', failure === 'quota' ? 'QuotaExceededError' : 'AbortError');
        }
        return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
      };
      let error = '';
      try { await LibraryDb.open(name); } catch (caught) { error = (caught as Error).message; }
      finally { IDBObjectStore.prototype.add = originalAdd; }
      const opened = indexedDB.open(name, 2);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error);
      });
      const current = await new Promise<{ visitId: string }>((resolve, reject) => {
        const get = db.transaction('photos').objectStore('photos').get(photoId);
        get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error);
      });
      const result = { error, version: db.version, stores: [...db.objectStoreNames], visitId: current.visitId };
      db.close();
      return result;
    }, { ...seed, failure });
    expect(result.error).toBeTruthy();
    expect(result.version).toBe(2);
    expect(result.stores).not.toContain('photoAlbumLinks');
    expect(result.visitId).toBe((seed.original as { visitId: string }).visitId);
  });
}

test('legacy membership writes fail closed while recovery remains readable', async ({ page }) => {
  await isolated(page);
  const seed = await seedV2(page);
  const result = await page.evaluate(async ({ name, photoId, original, tripId }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newVisit } = await import('../../src/domain/visits');
    const photo = original as Awaited<ReturnType<typeof db.listPhotos>>[number];
    const db = await LibraryDb.open(name);
    const before = await db.listPhotoAlbumLinks();
    const errors: string[] = [];
    for (const operation of [
      () => db.setPhotoVisit(photoId, null),
      () => db.savePhotoVisitBatch({} as Parameters<typeof db.savePhotoVisitBatch>[0]),
      () => db.createVisit(newVisit(tripId, '旧UIからの作成'), [photoId]),
      () => db.savePhoto(photo, null),
      () => db.restoreNew({ trips: [], visits: [], photos: [photo], thumbnails: [] }),
    ]) {
      try { await operation(); } catch (error) { errors.push((error as Error).message); }
    }
    const after = await db.listPhotoAlbumLinks();
    const backedUpLinks = (await db.snapshot()).links;
    const recoveryCount = (await db.listRecovery()).length;
    db.close();
    return { before, after, backedUpLinks, errors, recoveryCount };
  }, seed);
  expect(result.after).toEqual(result.before);
  expect(result.backedUpLinks).toEqual(result.before);
  expect(result.errors).toHaveLength(5);
  expect(result.recoveryCount).toBe(2);
});

test('blocked upgrade waits for the older tab, then completes after it closes', async ({ page }) => {
  await isolated(page);
  const seed = await seedV2(page);
  const result = await page.evaluate(async name => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const opened = indexedDB.open(name, 2);
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error);
    });
    let blocked = false;
    const pending = LibraryDb.open(name, { onBlocked: () => { blocked = true; } });
    await new Promise(resolve => setTimeout(resolve, 100));
    const beforeClose = blocked;
    old.close();
    const db = await pending;
    const count = (await db.listPhotoAlbumLinks()).length;
    db.close();
    return { beforeClose, count };
  }, seed.name);
  expect(result).toEqual({ beforeClose: true, count: 1 });
});

test('an open v3 tab closes its connection for a later version change', async ({ page }) => {
  await isolated(page);
  const seed = await seedV2(page);
  const result = await page.evaluate(async name => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    let versionChanged = false;
    const db = await LibraryDb.open(name, { onVersionChange: () => { versionChanged = true; } });
    const opened = indexedDB.open(name, 4);
    const later = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error);
    });
    const version = later.version;
    later.close(); db.close();
    return { versionChanged, version };
  }, seed.name);
  expect(result).toEqual({ versionChanged: true, version: 4 });
});

for (const count of [1_000, 5_000]) {
  test(`migrates ${count} synthetic photos without duplicate links`, async ({ page }) => {
    test.setTimeout(180_000);
    await isolated(page);
    const seed = await seedV2(page, { count });
    const result = await page.evaluate(async name => {
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const start = performance.now();
      const db = await LibraryDb.open(name);
      const migrationMs = performance.now() - start;
      const links = await db.listPhotoAlbumLinks();
      const photos = await db.listPhotos();
      db.close();
      return { migrationMs, links: links.length, photos: photos.length,
        nonNullVisitIds: photos.filter(photo => photo.visitId !== null).length };
    }, seed.name);
    console.log(`B1 migration ${count}: ${JSON.stringify(result)}`);
    expect(result).toMatchObject({ links: count, photos: count + 1, nonNullVisitIds: 0 });
  });
}
