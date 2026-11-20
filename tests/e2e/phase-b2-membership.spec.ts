import { expect, test, type Page } from '@playwright/test';

async function isolated(page: Page): Promise<void> {
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
}

test('multiple albums, removal, grouped reads, no-op, idempotency and atomic Undo', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(3, 0, true);
    const db = await LibraryDb.open(ids.name);
    const original = (await db.listPhotos()).find(photo => photo.id === ids.photoIds[0])!;
    const thumbnailBefore = await db.getThumbnail(original.thumbnailId!);
    const thumbnailBeforeBytes = Array.from(new Uint8Array(await thumbnailBefore!.blob.arrayBuffer()));
    const request = await membershipRequest(db, ids.tripId, {
      [ids.photoIds[0]!]: ids.albumIds.slice(0, 3), [ids.photoIds[1]!]: [ids.albumIds[1]!],
    });
    const saved = await db.saveAlbumMembershipBatch(request);
    const status = await db.albumMembershipOperationStatus(request.operationId);
    const duplicate = await db.saveAlbumMembershipBatch(request);
    let reused = '';
    try { await db.saveAlbumMembershipBatch({ ...request, changes: request.changes.map(change => ({
      ...change, afterAlbumIds: change.beforePhoto.id === ids.photoIds[0] ? [ids.albumIds[0]!, ids.albumIds[2]!] : [ids.albumIds[1]!],
    })) }); }
    catch (error) { reused = (error as { reason?: string }).reason ?? ''; }
    const memberships = await db.albumIdsForPhoto(ids.photoIds[0]!);
    const albumPhotos = await db.photoIdsForAlbum(ids.albumIds[1]!);
    const groupPhotos = await db.albumIdsForPhotos(ids.photoIds);
    const groupAlbums = await db.photoIdsForAlbums(ids.albumIds.slice(0, 3));
    const afterPhoto = (await db.listPhotos()).find(photo => photo.id === ids.photoIds[0])!;
    const thumbnailAfter = await db.getThumbnail(original.thumbnailId!);
    const thumbnailAfterBytes = Array.from(new Uint8Array(await thumbnailAfter!.blob.arrayBuffer()));
    const thumbnailCount = (await db.listThumbnails()).length;
    const historyCount = (await db.listRecovery()).length;
    const noop = await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: memberships }));
    const noOpStatus = await db.albumMembershipOperationStatus(noop.operationId);
    const afterNoopHistory = (await db.listRecovery()).length;
    const undone = await db.undoLatest();
    let secondUndo = '';
    try { await db.undoLatest(); } catch (error) { secondUndo = (error as Error).message; }
    const afterUndo = await db.albumIdsForPhotos(ids.photoIds);
    const undoStatus = await db.albumMembershipOperationStatus(request.operationId);
    const second = await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[0]!] }));
    const removeOne = await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId, {
      [ids.photoIds[0]!]: [ids.albumIds[1]!, ids.albumIds[2]!],
    }));
    const afterMixed = await db.albumIdsForPhoto(ids.photoIds[0]!);
    const clear = await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [] }));
    const unlinked = await db.albumIdsForPhoto(ids.photoIds[0]!);
    db.close();
    const unavailable = await db.albumMembershipOperationStatus(request.operationId);
    return { ids, original, saved, status, duplicate, reused, memberships, albumPhotos, groupPhotos, groupAlbums,
      afterPhoto, thumbnailBeforeBytes, thumbnailAfterBytes, thumbnailCount, historyCount, noop, noOpStatus,
      afterNoopHistory, undone, secondUndo, afterUndo, undoStatus, second, removeOne, afterMixed, clear, unlinked, unavailable };
  });
  expect(result.saved).toMatchObject({ status: 'saved', changedPhotos: 2, added: 4, removed: 0 });
  expect(result.status).toBe('applied');
  expect(result.duplicate.status).toBe('already-applied');
  expect(result.reused).toBe('operation-id-reused');
  expect(result.memberships).toEqual(result.ids.albumIds.slice(0, 3).sort());
  expect(result.albumPhotos).toEqual(result.ids.photoIds.slice(0, 2).sort());
  expect(result.groupPhotos[result.ids.photoIds[2]!]).toEqual([]);
  expect(result.groupAlbums[result.ids.albumIds[0]!]).toEqual([result.ids.photoIds[0]]);
  expect(result.afterPhoto).toEqual(result.original);
  expect(result.thumbnailCount).toBe(1);
  expect(result.thumbnailAfterBytes).toEqual(result.thumbnailBeforeBytes);
  expect(result.historyCount).toBe(1);
  expect(result.noop.status).toBe('no-change');
  expect(result.noOpStatus).toBe('absent');
  expect(result.afterNoopHistory).toBe(1);
  expect(result.undone.kind).toBe('photo-album-batch');
  expect(result.secondUndo).toContain('元に戻せる操作がありません');
  expect(result.afterUndo[result.ids.photoIds[0]!]).toEqual([]);
  expect(result.afterUndo[result.ids.photoIds[1]!]).toEqual([]);
  expect(result.undoStatus).toBe('undone');
  expect(result.second.added).toBe(1);
  expect(result.removeOne).toMatchObject({ added: 2, removed: 1 });
  expect(result.afterMixed).toEqual(result.ids.albumIds.slice(1, 3).sort());
  expect(result.clear.removed).toBe(2);
  expect(result.unlinked).toEqual([]);
  expect(result.unavailable).toBe('unknown');
});

test('a migrated trash-album link is retained while adding an active album', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(1);
    const opened = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = raw.transaction('photoAlbumLinks', 'readwrite');
    tx.objectStore('photoAlbumLinks').add({ albumId: ids.albumIds[3]!, photoId: ids.photoIds[0]!, createdAt: null });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    raw.close();
    const db = await LibraryDb.open(ids.name);
    const request = await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[3]!, ids.albumIds[0]!] });
    const saved = await db.saveAlbumMembershipBatch(request);
    const after = await db.listPhotoAlbumLinks(ids.photoIds[0]!);
    await db.undoLatest();
    const restored = await db.listPhotoAlbumLinks(ids.photoIds[0]!);
    db.close();
    return { ids, saved, after, restored };
  });
  expect(result.saved).toMatchObject({ status: 'saved', added: 1, removed: 0 });
  expect(result.after.map(link => link.albumId).sort()).toEqual([result.ids.albumIds[0], result.ids.albumIds[3]].sort());
  expect(result.restored).toEqual([{ albumId: result.ids.albumIds[3], photoId: result.ids.photoIds[0], createdAt: null }]);
});

test('stale photos, links, albums and invalid targets reject the whole batch', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { photoSchema } = await import('../../src/domain/model');
    const ids = await seedAlbumDb(3);
    const db = await LibraryDb.open(ids.name);
    const desired = { [ids.photoIds[0]!]: [ids.albumIds[0]!], [ids.photoIds[1]!]: [ids.albumIds[0]!] };
    const stalePhoto = await membershipRequest(db, ids.tripId, desired);
    await db.updatePhotoCorrection(ids.photoIds[1]!, { gpsCorrection: { value: { latitude: 36, longitude: 140 }, correctedAt: new Date().toISOString(), source: 'manual' } });
    const reasons: Record<string, string> = {};
    const attempt = async (label: string, request: Parameters<typeof db.saveAlbumMembershipBatch>[0]) => {
      try { await db.saveAlbumMembershipBatch(request); reasons[label] = 'unexpected-success'; }
      catch (error) { reasons[label] = (error as { reason?: string }).reason ?? (error as Error).name; }
    };
    await attempt('photo', stalePhoto);
    const staleLinks = await membershipRequest(db, ids.tripId, desired);
    const other = await LibraryDb.open(ids.name);
    await other.saveAlbumMembershipBatch(await membershipRequest(other, ids.tripId, { [ids.photoIds[1]!]: [ids.albumIds[1]!] }));
    other.close();
    await attempt('links', staleLinks);
    const staleAlbum = await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[0]!] });
    const album = (await db.listVisits()).find(visit => visit.id === ids.albumIds[0])!;
    await db.updateVisit({ ...album, label: 'Changed', updatedAt: new Date().toISOString() });
    await attempt('album', staleAlbum);
    await attempt('crossTrip', await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[4]!] }));
    const orphan = photoSchema.parse({ ...(await db.listPhotos())[0]!, id: crypto.randomUUID(), tripId: null,
      originalFilename: 'unclassified.jpg', contentSha256: 'e'.repeat(64) });
    await db.savePhoto(orphan, null);
    await attempt('unclassifiedPhoto', await membershipRequest(db, ids.tripId, { [orphan.id]: [ids.albumIds[0]!] }));
    const missingId = crypto.randomUUID();
    const missing = await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[0]!] });
    await attempt('missingAlbum', { ...missing, expectedAlbums: [{ ...missing.expectedAlbums[0]!, id: missingId }],
      changes: [{ ...missing.changes[0]!, afterAlbumIds: [missingId] }] });
    await attempt('trashedAlbum', await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[3]!] }));
    const trashedPhoto = await membershipRequest(db, ids.tripId, { [ids.photoIds[2]!]: [ids.albumIds[0]!] });
    await db.moveToTrash('photo', ids.photoIds[2]!);
    await attempt('trashedPhoto', trashedPhoto);
    const duplicate = await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: [ids.albumIds[0]!] });
    await attempt('duplicateAlbum', { ...duplicate, changes: [{ ...duplicate.changes[0]!, afterAlbumIds: [ids.albumIds[0]!, ids.albumIds[0]!] }] });
    await attempt('duplicatePhoto', { ...duplicate, changes: [duplicate.changes[0]!, duplicate.changes[0]!] });
    const links = await db.albumIdsForPhotos(ids.photoIds);
    db.close();
    return { ids, reasons, links };
  });
  expect(result.reasons).toMatchObject({ photo: 'photo-changed', links: 'membership-changed', album: 'album-changed',
    crossTrip: 'trip-mismatch', unclassifiedPhoto: 'trip-or-legacy-membership', missingAlbum: 'album-changed',
    trashedAlbum: 'album-in-trash', trashedPhoto: 'photo-changed',
    duplicateAlbum: 'duplicate-album-id', duplicatePhoto: 'duplicate-photo-id' });
  expect(result.links[result.ids.photoIds[0]!]).toEqual([]);
  expect(result.links[result.ids.photoIds[1]!]).toEqual([result.ids.albumIds[1]]);
  expect(result.links[result.ids.photoIds[2]!]).toEqual([]);
});

test('link, history and Undo write failures leave links and history atomic', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(3);
    const db = await LibraryDb.open(ids.name);
    const request = await membershipRequest(db, ids.tripId, Object.fromEntries(ids.photoIds.map(id => [id, [ids.albumIds[0]!]])));
    const originalAdd = IDBObjectStore.prototype.add, originalPut = IDBObjectStore.prototype.put,
      originalDelete = IDBObjectStore.prototype.delete;
    const failures: string[] = [];
    const failAdd = async (storeName: string) => {
      IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
        if (this.name === storeName) throw new DOMException('synthetic failure', 'QuotaExceededError');
        return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
      };
      try { await db.saveAlbumMembershipBatch(request); failures.push('unexpected-success'); }
      catch (error) { failures.push((error as Error).name); }
      finally { IDBObjectStore.prototype.add = originalAdd; }
      return { links: (await db.listPhotoAlbumLinks()).length, history: (await db.listRecovery()).length };
    };
    const linkFailure = await failAdd('photoAlbumLinks');
    const historyFailure = await failAdd('recovery');
    const saved = await db.saveAlbumMembershipBatch(request);
    let deletes = 0;
    IDBObjectStore.prototype.delete = function (key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'photoAlbumLinks' && ++deletes === 2) throw new DOMException('synthetic undo link failure', 'QuotaExceededError');
      return originalDelete.call(this, key);
    };
    try { await db.undoLatest(); failures.push('unexpected-undo'); }
    catch (error) { failures.push((error as Error).name); }
    finally { IDBObjectStore.prototype.delete = originalDelete; }
    const afterFailedLinkUndo = { links: (await db.listPhotoAlbumLinks()).length, history: (await db.listRecovery())[0]?.undoneAt };
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'recovery') throw new DOMException('synthetic undo failure', 'QuotaExceededError');
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    try { await db.undoLatest(); failures.push('unexpected-undo'); }
    catch (error) { failures.push((error as Error).name); }
    finally { IDBObjectStore.prototype.put = originalPut; }
    const afterFailedUndo = { links: (await db.listPhotoAlbumLinks()).length, history: (await db.listRecovery())[0]?.undoneAt };
    const undone = await db.undoLatest();
    const afterUndo = (await db.listPhotoAlbumLinks()).length;
    db.close();
    return { failures, linkFailure, historyFailure, saved, afterFailedLinkUndo, afterFailedUndo, undone: undone.kind, afterUndo };
  });
  expect(result.failures).toEqual(['QuotaExceededError', 'QuotaExceededError', 'QuotaExceededError', 'QuotaExceededError']);
  expect(result.linkFailure).toEqual({ links: 0, history: 0 });
  expect(result.historyFailure).toEqual({ links: 0, history: 0 });
  expect(result.saved.changedPhotos).toBe(3);
  expect(result.afterFailedLinkUndo).toEqual({ links: 3, history: null });
  expect(result.afterFailedUndo).toEqual({ links: 3, history: null });
  expect(result.undone).toBe('photo-album-batch');
  expect(result.afterUndo).toBe(0);
});

test('Undo rejects a changed member without partially restoring any photo', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(2);
    const db = await LibraryDb.open(ids.name);
    const first = await membershipRequest(db, ids.tripId, Object.fromEntries(ids.photoIds.map(id => [id, [ids.albumIds[0]!]])));
    await db.saveAlbumMembershipBatch(first);
    const opened = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = raw.transaction('photoAlbumLinks', 'readwrite');
    tx.objectStore('photoAlbumLinks').add({ albumId: ids.albumIds[1]!, photoId: ids.photoIds[1]!, createdAt: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    raw.close();
    let reason = '';
    try { await db.undoLatest(); } catch (error) { reason = (error as { reason?: string }).reason ?? ''; }
    const links = await db.albumIdsForPhotos(ids.photoIds);
    const history = await db.listRecovery();
    const status = await db.albumMembershipOperationStatus(first.operationId);
    db.close();
    return { ids, reason, links, history, status };
  });
  expect(result.reason).toBe('undo-membership-changed');
  expect(result.links[result.ids.photoIds[0]!]).toEqual([result.ids.albumIds[0]]);
  expect(result.links[result.ids.photoIds[1]!]).toEqual(result.ids.albumIds.slice(0, 2).sort());
  expect(result.history[0]?.undoneAt).toBeNull();
  expect(result.status).toBe('changed-after-save');
});

test('legacy single-membership Undo restores links without reviving Photo.visitId', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(1);
    const db = await LibraryDb.open(ids.name);
    const before = (await db.listPhotos())[0]!;
    const after = { ...before, visitId: ids.albumIds[0]!, updatedAt: new Date(Date.now() + 1000).toISOString() };
    const opened = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = raw.transaction(['photos', 'photoAlbumLinks', 'recovery'], 'readwrite');
    tx.objectStore('photos').put({ ...after, visitId: null });
    tx.objectStore('photoAlbumLinks').add({ albumId: ids.albumIds[0]!, photoId: before.id, createdAt: null });
    tx.objectStore('recovery').add({ id: crypto.randomUUID(), kind: 'photo', action: '写真のアルバム所属変更',
      targetId: before.id, createdAt: after.updatedAt, before, after, undoneAt: null });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    raw.close();
    const undone = await db.undoLatest();
    const photo = (await db.listPhotos())[0];
    const links = await db.listPhotoAlbumLinks();
    const history = await db.listRecovery();
    db.close();
    return { undone: undone.kind, before, photo, links, history };
  });
  expect(result.undone).toBe('photo');
  expect(result.photo).toEqual(result.before);
  expect(result.links).toEqual([]);
  expect(result.history[0]?.undoneAt).toBeTruthy();
});

test('a real v2-to-v3 migration keeps an old single-move history safely undoable', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedLegacyV2Move } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedLegacyV2Move();
    const db = await LibraryDb.open(ids.name);
    const migrated = await db.listPhotoAlbumLinks(ids.photoId);
    const undone = await db.undoLatest();
    const afterUndo = await db.listPhotoAlbumLinks(ids.photoId);
    const photo = (await db.listPhotos()).find(item => item.id === ids.photoId)!;
    db.close();
    return { ids, migrated, undone: undone.kind, afterUndo, photo };
  });
  expect(result.migrated).toEqual([{ albumId: result.ids.afterAlbumId, photoId: result.ids.photoId, createdAt: null }]);
  expect(result.undone).toBe('photo');
  expect(result.afterUndo).toEqual([{ albumId: result.ids.beforeAlbumId, photoId: result.ids.photoId, createdAt: null }]);
  expect(result.photo.visitId).toBeNull();
});

test('legacy batch Undo restores all prior links without reviving Photo.visitId', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(2);
    const db = await LibraryDb.open(ids.name);
    const originals = await db.listPhotos();
    const now = new Date(Date.now() + 1000).toISOString();
    const opened = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = raw.transaction(['photos', 'photoAlbumLinks', 'recovery'], 'readwrite');
    for (const photo of originals) {
      tx.objectStore('photos').put({ ...photo, updatedAt: now });
      tx.objectStore('photoAlbumLinks').add({ albumId: ids.albumIds[1]!, photoId: photo.id, createdAt: null });
    }
    tx.objectStore('recovery').add({ id: crypto.randomUUID(), kind: 'photo-visit-batch', action: '旧一括所属変更',
      targetId: ids.albumIds[1]!, createdAt: now,
      changes: originals.map(photo => ({ before: { ...photo, visitId: ids.albumIds[0]! }, afterVisitId: ids.albumIds[1]!, afterUpdatedAt: now })), undoneAt: null });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    raw.close();
    const undone = await db.undoLatest();
    const restored = await db.listPhotoAlbumLinks();
    const photos = await db.listPhotos();
    db.close();
    return { ids, undone: undone.kind, restored, photos, originals };
  });
  expect(result.undone).toBe('photo-visit-batch');
  expect(result.restored).toHaveLength(2);
  expect(result.restored.every(link => link.albumId === result.ids.albumIds[0] && link.createdAt === null)).toBe(true);
  expect(result.photos).toEqual(result.originals);
});

test('unsafe legacy membership Undo is blocked and leaves the history readable', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(1);
    const db = await LibraryDb.open(ids.name);
    const before = (await db.listPhotos())[0]!;
    const after = { ...before, visitId: ids.albumIds[0]! };
    const opened = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = raw.transaction(['photoAlbumLinks', 'recovery'], 'readwrite');
    tx.objectStore('photoAlbumLinks').add({ albumId: ids.albumIds[0]!, photoId: before.id, createdAt: null });
    tx.objectStore('photoAlbumLinks').add({ albumId: ids.albumIds[1]!, photoId: before.id, createdAt: new Date().toISOString() });
    tx.objectStore('recovery').add({ id: crypto.randomUUID(), kind: 'photo', action: '写真のアルバム所属変更',
      targetId: before.id, createdAt: before.updatedAt, before, after, undoneAt: null });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    raw.close();
    let reason = '';
    try { await db.undoLatest(); } catch (error) { reason = (error as { reason?: string }).reason ?? ''; }
    const links = await db.listPhotoAlbumLinks();
    const history = await db.listRecovery();
    db.close();
    return { reason, links, history };
  });
  expect(result.reason).toBe('undo-legacy-membership-changed');
  expect(result.links).toHaveLength(2);
  expect(result.history[0]?.undoneAt).toBeNull();
});

test('legacy batch Undo rejects one extra link without changing the other photo', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(2);
    const db = await LibraryDb.open(ids.name);
    const originals = await db.listPhotos();
    const now = new Date(Date.now() + 1000).toISOString();
    const opened = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = raw.transaction(['photos', 'photoAlbumLinks', 'recovery'], 'readwrite');
    for (const photo of originals) {
      tx.objectStore('photos').put({ ...photo, updatedAt: now });
      tx.objectStore('photoAlbumLinks').add({ albumId: ids.albumIds[1]!, photoId: photo.id, createdAt: null });
    }
    tx.objectStore('photoAlbumLinks').add({ albumId: ids.albumIds[2]!, photoId: originals[1]!.id, createdAt: now });
    tx.objectStore('recovery').add({ id: crypto.randomUUID(), kind: 'photo-visit-batch', action: '旧一括所属変更',
      targetId: ids.albumIds[1]!, createdAt: now,
      changes: originals.map(photo => ({ before: { ...photo, visitId: ids.albumIds[0]! }, afterVisitId: ids.albumIds[1]!, afterUpdatedAt: now })), undoneAt: null });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    raw.close();
    let reason = '';
    try { await db.undoLatest(); } catch (error) { reason = (error as { reason?: string }).reason ?? ''; }
    const links = await db.albumIdsForPhotos(ids.photoIds);
    const history = await db.listRecovery();
    db.close();
    return { ids, extraPhotoId: originals[1]!.id, reason, links, history };
  });
  expect(result.reason).toBe('undo-legacy-membership-changed');
  for (const photoId of result.ids.photoIds) expect(result.links[photoId]).toEqual(
    photoId === result.extraPhotoId ? result.ids.albumIds.slice(1, 3).sort() : [result.ids.albumIds[1]],
  );
  expect(result.history[0]?.undoneAt).toBeNull();
});

test('legacy Photo correction and Visit trash Undo preserve independent memberships', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(1);
    const db = await LibraryDb.open(ids.name);
    await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId, { [ids.photoIds[0]!]: ids.albumIds.slice(0, 2) }));
    const before = (await db.listPhotos())[0]!;
    const after = { ...before, metadataIssues: ['legacy correction'] };
    const opened = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = raw.transaction(['photos', 'recovery'], 'readwrite');
    tx.objectStore('photos').put(after);
    tx.objectStore('recovery').add({ id: crypto.randomUUID(), kind: 'photo', action: '写真の手動補正',
      targetId: before.id, createdAt: before.updatedAt,
      before: { ...before, visitId: ids.albumIds[0]! }, after: { ...after, visitId: ids.albumIds[0]! }, undoneAt: null });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    raw.close();
    const correctionUndo = await db.undoLatest();
    const photo = (await db.listPhotos())[0];
    const linksAfterCorrection = await db.albumIdsForPhoto(ids.photoIds[0]!);
    await db.moveToTrash('visit', ids.albumIds[0]!);
    const visitUndo = await db.undoLatest();
    const visit = (await db.listVisits()).find(item => item.id === ids.albumIds[0]);
    const linksAfterVisit = await db.albumIdsForPhoto(ids.photoIds[0]!);
    await db.moveToTrash('trip', ids.tripId);
    const tripUndo = await db.undoLatest();
    const trip = (await db.listTrips()).find(item => item.id === ids.tripId);
    const linksAfterTrip = await db.albumIdsForPhoto(ids.photoIds[0]!);
    db.close();
    return { ids, before, correctionUndo: correctionUndo.kind, photo, linksAfterCorrection,
      visitUndo: visitUndo.kind, visit, linksAfterVisit, tripUndo: tripUndo.kind, trip, linksAfterTrip };
  });
  expect(result.correctionUndo).toBe('photo');
  expect(result.photo).toEqual(result.before);
  expect(result.linksAfterCorrection).toEqual(result.ids.albumIds.slice(0, 2).sort());
  expect(result.visitUndo).toBe('visit');
  expect(result.visit?.deletedAt).toBeNull();
  expect(result.linksAfterVisit).toEqual(result.ids.albumIds.slice(0, 2).sort());
  expect(result.tripUndo).toBe('trip');
  expect(result.trip?.deletedAt).toBeNull();
  expect(result.linksAfterTrip).toEqual(result.ids.albumIds.slice(0, 2).sort());
});

for (const count of [100, 1_000, 5_000]) {
  test(`${count} photos: save, Undo and small-edit cost`, async ({ page }) => {
    test.setTimeout(180_000);
    await isolated(page);
    const result = await page.evaluate(async count => {
      const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const ids = await seedAlbumDb(count, count === 5_000 ? 64 : 1024);
      const db = await LibraryDb.open(ids.name);
      const targets = count === 5_000 ? ids.photoIds.slice(0, 3) : ids.photoIds;
      const request = await membershipRequest(db, ids.tripId, Object.fromEntries(targets.map(id => [id, [ids.albumIds[0]!, ids.albumIds[1]!]])));
      const start = performance.now();
      const saved = await db.saveAlbumMembershipBatch(request);
      const saveMs = performance.now() - start;
      const recovery = (await db.listRecovery())[0]!;
      const historyBytes = new TextEncoder().encode(JSON.stringify(recovery)).byteLength;
      const undoStart = performance.now();
      await db.undoLatest();
      const undoMs = performance.now() - undoStart;
      const after = await db.listPhotoAlbumLinks();
      db.close();
      return { count, changed: saved.changedPhotos, saveMs, undoMs, historyBytes, remainingLinks: after.length };
    }, count);
    console.log(`B2 performance ${JSON.stringify(result)}`);
    expect(result.changed).toBe(count === 5_000 ? 3 : count);
    expect(result.remainingLinks).toBe(0);
  });
}
