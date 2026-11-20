import { expect, test } from '@playwright/test';

// The old Photo.visitId batch is intentionally disabled in v3. Its atomicity, concurrency,
// failure and scale cases now run against saveAlbumMembershipBatch in phase-b2-membership.spec.ts.
// ZIP v1/v2 compatibility is covered by phase-b3-archive.spec.ts.
test('legacy single and batch membership APIs reject v3 without changing links or history', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { seedAlbumDb } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newVisit } = await import('../../src/domain/visits');
    const ids = await seedAlbumDb(1), db = await LibraryDb.open(ids.name);
    const photo = (await db.listPhotos())[0]!, before = await db.snapshot();
    let single = false, batch = false, status = false, create = false;
    try { await db.setPhotoVisit(photo.id, ids.albumIds[0]!); } catch { single = true; }
    try { await db.savePhotoVisitBatch({} as Parameters<typeof db.savePhotoVisitBatch>[0]); } catch { batch = true; }
    try { await db.photoVisitBatchStatus(crypto.randomUUID()); } catch { status = true; }
    try { await db.createVisit(newVisit(ids.tripId, 'Legacy'), [photo.id]); } catch { create = true; }
    const after = await db.snapshot(), history = await db.listRecovery(); db.close();
    return { single, batch, status, create,
      same: JSON.stringify(before) === JSON.stringify(after), history: history.length };
  });
  expect(result).toEqual({ single: true, batch: true, status: true, create: true, same: true, history: 0 });
});

test('v3 mixed additions and removals preserve other and trash links; one Undo restores the batch', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { seedAlbumDb, membershipRequest } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const ids = await seedAlbumDb(4), db = await LibraryDb.open(ids.name);
    const [a, b, , trash] = ids.albumIds;
    const opened = indexedDB.open(ids.name, 3);
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error);
    });
    const tx = raw.transaction('photoAlbumLinks', 'readwrite');
    tx.objectStore('photoAlbumLinks').add({ albumId: trash!, photoId: ids.photoIds[2]!, createdAt: null });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    raw.close();
    await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId, {
      [ids.photoIds[0]!]: [a!, b!], [ids.photoIds[1]!]: [b!],
    }));
    const before = await db.snapshot();
    const saved = await db.saveAlbumMembershipBatch(await membershipRequest(db, ids.tripId, {
      [ids.photoIds[0]!]: [b!], [ids.photoIds[1]!]: [a!, b!],
      [ids.photoIds[2]!]: [a!, trash!], [ids.photoIds[3]!]: [a!],
    }));
    const after = await db.snapshot();
    await db.undoLatest();
    const undone = await db.snapshot();
    const history = await db.listRecovery(); db.close();
    return { saved, beforeLinks: before.links, afterLinks: after.links, undoneLinks: undone.links,
      beforePhotos: before.photos, afterPhotos: after.photos, historyKinds: history.map(entry => entry.kind),
      undoneAt: history.at(-1)?.undoneAt };
  });
  expect(result.saved).toMatchObject({ status: 'saved', changedPhotos: 4, added: 3, removed: 1 });
  expect(result.afterLinks).toHaveLength(6);
  expect(result.undoneLinks).toEqual(result.beforeLinks);
  expect(result.afterPhotos).toEqual(result.beforePhotos);
  expect(result.historyKinds).toEqual(['photo-album-batch', 'photo-album-batch']);
  expect(result.undoneAt).not.toBeNull();
});
