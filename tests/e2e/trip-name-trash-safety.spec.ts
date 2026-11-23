import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createTripUi, localUi } from './helpers/ux-rc-flows';

test.beforeEach(async ({ page }) => { await localUi(page); await page.goto('/'); await expect(page.locator('#photo-count')).toHaveText('写真 0枚'); });

async function openVerifiedDelete(page: Page) {
  const data = await page.evaluate(async () => {
    const { seedTrashSafety } = await import('../../tests/e2e/helpers/trash-safety');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive } = await import('../../src/infrastructure/archive');
    const ids = await seedTrashSafety('photo-route-library'), db = await LibraryDb.open();
    await db.moveToTrash('photo', ids.photos[0]!); const archive = await exportArchive(await db.snapshot()); db.close();
    return { ids, bytes: [...new Uint8Array(await archive.arrayBuffer())] };
  });
  await page.reload(); await page.locator('#header-manage').click(); await page.locator('#trash-section > summary').click();
  await page.locator(`[data-trash-id="${data.ids.photos[0]}"] .trash-delete-open`).click();
  await expect(page.locator('#trash-delete-backup')).toBeEnabled();
  await page.locator('#trash-delete-backup').setInputFiles({ name: 'synthetic-backup.zip', mimeType: 'application/zip', buffer: Buffer.from(data.bytes) });
  await expect(page.locator('#trash-delete-commit')).toBeEnabled();
  return data;
}

test('trip creation rejects exact, trimmed, trashed and racing names while retaining legacy duplicate restores', async ({ page }) => {
  await createTripUi(page, '合成旅行');
  await page.locator('#trip-select').selectOption('__create-trip__');
  await page.locator('#trip-name').fill('  合成旅行  '); await page.locator('#trip-create-submit').click();
  await expect(page.locator('#trip-create-status')).toContainText('同じ名前の旅行があります');
  await expect(page.locator('#trip-name')).toHaveValue('  合成旅行  ');
  await expect(page.locator('#trip-create-dialog')).toBeVisible();
  await page.locator('#trip-create-cancel').click();
  const result = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip } = await import('../../src/domain/model');
    const first = await LibraryDb.open(), second = await LibraryDb.open();
    const original = (await first.listTrips())[0]!;
    const failures: string[] = [];
    await first.moveToTrash('trip', original.id);
    try { await first.createTrip(newTrip('合成旅行')); } catch (error) { failures.push((error as Error).message); }
    const race = await Promise.allSettled([first.createTrip(newTrip('競合する旅行')), second.createTrip(newTrip('  競合する旅行  '))]);
    await first.restoreNew({ trips: [newTrip('旧データの同名'), newTrip('旧データの同名')], visits: [], photos: [], thumbnails: [], links: [] });
    const trips = await first.listTrips(); first.close(); second.close();
    return { failures, race: race.map(item => item.status), duplicates: trips.filter(item => item.name === '旧データの同名').length,
      racing: trips.filter(item => item.name === '競合する旅行').length, original: trips.filter(item => item.name === '合成旅行').length };
  });
  expect(result.failures[0]).toContain('ごみ箱'); expect(result.race.sort()).toEqual(['fulfilled', 'rejected']);
  expect(result.racing).toBe(1); expect(result.original).toBe(1); expect(result.duplicates).toBe(2);
});

for (const kind of ['trip', 'visit', 'photo'] as const) test(`verified ${kind} deletion preserves other data, prevents Undo resurrection and restores through ZIP`, async ({ page }) => {
  const result = await page.evaluate(async kind => {
    const { seedTrashSafety } = await import('../../tests/e2e/helpers/trash-safety');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive, restoreArchive, snapshotFingerprint } = await import('../../src/infrastructure/archive');
    const ids = await seedTrashSafety(), db = await LibraryDb.open(ids.name);
    const target = kind === 'trip' ? ids.trip : kind === 'visit' ? ids.albums[0]! : ids.photos[0]!;
    const recovery = await db.moveToTrash(kind, target), before = await db.snapshot();
    const otherPart = (snapshot: typeof before) => {
      const photos = snapshot.photos.filter(item => item.tripId === ids.other), photoIds = new Set(photos.map(item => item.id));
      return { trips: snapshot.trips.filter(item => item.id === ids.other), visits: snapshot.visits.filter(item => item.tripId === ids.other), photos,
        thumbnails: snapshot.thumbnails.filter(item => photoIds.has(item.photoId)), links: snapshot.links.filter(item => photoIds.has(item.photoId)) };
    };
    const history = await db.listRecovery(), jobs = await db.listJobs(), archive = await exportArchive(before);
    const plan = await db.prepareTrashDeletion(kind, target);
    await db.verifyTrashDeletionBackup(plan, archive); await db.permanentlyDeleteFromTrash(plan);
    const after = await db.snapshot(), hash = await snapshotFingerprint(after);
    const status = await db.trashDeletionStatus(plan);
    let undoRejected = false, repeatedRejected = false;
    try { await db.undoLatest(recovery); } catch { undoRejected = true; }
    try { await db.permanentlyDeleteFromTrash(plan); } catch { repeatedRejected = true; }
    const unchangedAfterUndo = hash === await snapshotFingerprint(await db.snapshot());
    const historyPreserved = JSON.stringify(history) === JSON.stringify(await db.listRecovery());
    const jobsPreserved = JSON.stringify(jobs) === JSON.stringify(await db.listJobs());
    const restored = await restoreArchive(db, archive, kind === 'trip' ? 'reject-conflicts' : 'copy-conflicts');
    const final = await db.snapshot();
    const recoveredTrip = kind === 'trip' ? ids.trip : final.trips.find(item => !before.trips.some(old => old.id === item.id))!.id;
    const recoveredPhotos = final.photos.filter(item => item.tripId === recoveredTrip), recoveredAlbums = final.visits.filter(item => item.tripId === recoveredTrip);
    const recoveredPhotoIds = new Set(recoveredPhotos.map(item => item.id));
    db.close();
    return { plan, after: { trips: after.trips.length, albums: after.visits.length, photos: after.photos.length,
      thumbnails: after.thumbnails.length, links: after.links.length, other: after.trips.some(item => item.id === ids.other) },
      status, undoRejected, repeatedRejected, unchangedAfterUndo, historyPreserved, jobsPreserved, restored,
      otherUnchanged: await snapshotFingerprint(otherPart(before)) === await snapshotFingerprint(otherPart(after)),
      recovered: { photos: recoveredPhotos.length, albums: recoveredAlbums.length,
        thumbnails: final.thumbnails.filter(item => recoveredPhotoIds.has(item.photoId)).length,
        links: final.links.filter(item => recoveredPhotoIds.has(item.photoId)).length },
      exact: kind === 'trip' ? await snapshotFingerprint(final) === await snapshotFingerprint(before) : true };
  }, kind);
  expect(result.status).toBe('applied'); expect(result.undoRejected).toBe(true); expect(result.repeatedRejected).toBe(true);
  expect(result.unchangedAfterUndo).toBe(true); expect(result.historyPreserved).toBe(true); expect(result.jobsPreserved).toBe(true);
  expect(result.otherUnchanged).toBe(true);
  expect(result.after).toEqual(kind === 'trip' ? { trips: 1, albums: 1, photos: 1, thumbnails: 1, links: 1, other: true }
    : kind === 'visit' ? { trips: 2, albums: 2, photos: 3, thumbnails: 3, links: 2, other: true }
      : { trips: 2, albums: 3, photos: 2, thumbnails: 2, links: 2, other: true });
  expect(result.recovered).toEqual({ photos: 2, albums: 2, thumbnails: 2, links: 3 }); expect(result.exact).toBe(true);
});

test('unverified, malformed, wrong and stale backups, changed thumbnail bytes, and representative references refuse deletion', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { seedTrashSafety } = await import('../../tests/e2e/helpers/trash-safety');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip } = await import('../../src/domain/model');
    const { exportArchive, snapshotFingerprint } = await import('../../src/infrastructure/archive');
    const ids = await seedTrashSafety(), db = await LibraryDb.open(ids.name), other = await LibraryDb.open(ids.name);
    await db.moveToTrash('photo', ids.photos[0]!);
    const before = await db.snapshot(), archive = await exportArchive(before), failures: string[] = [];
    const reject = async (name: string, work: () => Promise<unknown>) => { try { await work(); } catch { failures.push(name); } };
    const unverified = await db.prepareTrashDeletion('photo', ids.photos[0]!);
    await reject('unverified', () => db.permanentlyDeleteFromTrash(unverified));
    await reject('foreign', () => other.verifyTrashDeletionBackup(unverified, archive));
    await reject('corrupt', () => db.verifyTrashDeletionBackup(unverified, new Blob(['broken'])));
    await reject('wrong', async () => db.verifyTrashDeletionBackup(unverified, await exportArchive({ trips: [], visits: [], photos: [], thumbnails: [], links: [] })));
    await reject('still-unverified', () => db.permanentlyDeleteFromTrash(unverified));
    await db.verifyTrashDeletionBackup(unverified, archive);
    const modified = before.thumbnails.find(item => item.photoId === ids.photos[0])!;
    const bytes = new Uint8Array(await modified.blob.arrayBuffer()); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(ids.name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = raw.transaction('thumbnails', 'readwrite'); tx.objectStore('thumbnails').put({ ...modified, blob: new Blob([bytes], { type: modified.mime }) });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); raw.close();
    await reject('changed-bytes', () => db.permanentlyDeleteFromTrash(unverified));
    // Restore only the synthetic thumbnail through the test-owned raw connection.
    const raw2 = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(ids.name); r.onsuccess = () => resolve(r.result); });
    const tx2 = raw2.transaction('thumbnails', 'readwrite'); tx2.objectStore('thumbnails').put(modified);
    await new Promise<void>(resolve => { tx2.oncomplete = () => resolve(); }); raw2.close();
    const stale = await db.prepareTrashDeletion('photo', ids.photos[0]!); await db.verifyTrashDeletionBackup(stale, archive);
    await other.createTrip(newTrip('別画面で追加'));
    await reject('changed-records', () => db.permanentlyDeleteFromTrash(stale));
    const latest = await db.prepareTrashDeletion('photo', ids.photos[0]!);
    await reject('old-zip', () => db.verifyTrashDeletionBackup(latest, archive));
    const album = (await db.listVisits()).find(item => item.id === ids.albums[0])!;
    await other.updateVisit({ ...album, representativePhotoId: ids.photos[0]!, locationSource: 'selected-photo' }, album);
    await reject('representative', () => db.prepareTrashDeletion('photo', ids.photos[0]!));
    const final = await db.snapshot();
    db.close(); other.close();
    return { failures, originalPhotos: final.photos.length === before.photos.length,
      originalThumbs: final.thumbnails.length === before.thumbnails.length,
      photoPreserved: final.photos.some(item => item.id === ids.photos[0]),
      originalHashChanged: await snapshotFingerprint(before) !== await snapshotFingerprint(final) };
  });
  expect(result.failures).toEqual(['unverified', 'foreign', 'corrupt', 'wrong', 'still-unverified', 'changed-bytes', 'changed-records', 'old-zip', 'representative']);
  expect(result.originalPhotos && result.originalThumbs && result.photoPreserved && result.originalHashChanged).toBe(true);
});

test('partial delete failure aborts every store and running trip imports refuse deletion', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { seedTrashSafety } = await import('../../tests/e2e/helpers/trash-safety');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive, snapshotFingerprint } = await import('../../src/infrastructure/archive');
    const ids = await seedTrashSafety(), db = await LibraryDb.open(ids.name);
    await db.moveToTrash('trip', ids.trip); const before = await db.snapshot(), archive = await exportArchive(before);
    const history = JSON.stringify(await db.listRecovery()), jobs = JSON.stringify(await db.listJobs());
    const plan = await db.prepareTrashDeletion('trip', ids.trip); await db.verifyTrashDeletionBackup(plan, archive);
    const originalDelete = IDBObjectStore.prototype.delete; let failed = false;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'photos') throw new DOMException('Synthetic delete failure', 'QuotaExceededError');
      return originalDelete.call(this, key);
    };
    try { await db.permanentlyDeleteFromTrash(plan); } catch { failed = true; } finally { IDBObjectStore.prototype.delete = originalDelete; }
    const rolledBack = await snapshotFingerprint(before) === await snapshotFingerprint(await db.snapshot());
    const status = await db.trashDeletionStatus(plan);
    const job = (await db.listJobs())[0]!; await db.saveJob({ ...job, state: 'running' });
    const pending = await db.prepareTrashDeletion('trip', ids.trip); await db.verifyTrashDeletionBackup(pending, archive);
    let runningRejected = false;
    try { await db.permanentlyDeleteFromTrash(pending); } catch (error) { runningRejected = (error as Error).message.includes('取り込み中'); }
    await db.saveJob(job);
    const historiesPreserved = history === JSON.stringify(await db.listRecovery()) && jobs === JSON.stringify(await db.listJobs());
    db.close(); return { failed, rolledBack, status, runningRejected, historiesPreserved };
  });
  expect(result).toEqual({ failed: true, rolledBack: true, status: 'not-applied', runningRejected: true, historiesPreserved: true });
});

for (const width of [1440, 320]) test(`confirmation at ${width}px cancels safely and requires verified ZIP before deletion`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
  const data = await page.evaluate(async () => {
    const { seedTrashSafety } = await import('../../tests/e2e/helpers/trash-safety');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive } = await import('../../src/infrastructure/archive');
    const ids = await seedTrashSafety('photo-route-library', `${'合成写真'.repeat(60)}.jpg`), db = await LibraryDb.open();
    await db.moveToTrash('photo', ids.photos[0]!); const archive = await exportArchive(await db.snapshot()); db.close();
    return { ids, bytes: [...new Uint8Array(await archive.arrayBuffer())] };
  });
  await page.reload(); await page.locator('#header-manage').click();
  await page.locator('#trash-section > summary').click();
  const open = page.locator(`[data-trash-id="${data.ids.photos[0]}"] .trash-delete-open`);
  await open.click();
  await expect(page.locator('#trash-delete-backup')).toBeEnabled();
  const dialog = page.locator('#trash-delete-dialog'), commit = page.locator('#trash-delete-commit');
  await expect(dialog).toBeVisible(); await expect(page.locator('#trash-delete-cancel')).toBeFocused(); await expect(commit).toBeDisabled();
  await expect(page.locator('#trash-delete-summary')).toContainText('写真1枚');
  await expect(page.locator('#trash-delete-summary')).toBeInViewport(); await expect(page.locator('#trash-delete-cancel')).toBeInViewport();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(open).toBeFocused();
  await open.click();
  await expect(page.locator('#trash-delete-backup')).toBeEnabled();
  await page.locator('#trash-delete-backup').setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid') });
  await expect(page.locator('#trash-delete-status')).toContainText('ZIPを確認できません'); await expect(commit).toBeDisabled();
  await page.locator('#trash-delete-backup').setInputFiles({ name: 'synthetic-backup.zip', mimeType: 'application/zip', buffer: Buffer.from(data.bytes) });
  await expect(page.locator('#trash-delete-status')).toContainText('ZIPの内容が一致しました'); await expect(commit).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  mkdirSync('test-results/trash-safety', { recursive: true });
  await page.screenshot({ path: `test-results/trash-safety/confirm-${width}.png` });
  await commit.click(); await expect(page.locator('#trash-delete-status')).toContainText('完全に削除しました');
  await expect(commit).toBeHidden(); await page.locator('#trash-delete-cancel').click();
  await expect(page.locator(`[data-trash-id="${data.ids.photos[0]}"]`)).toHaveCount(0);
});

test('busy confirmation prevents closing and double sending, then resolves a lost completion response', async ({ page }) => {
  await openVerifiedDelete(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    const original = LibraryDb.prototype.permanentlyDeleteFromTrash;
    const state = window as unknown as { releaseDeletion: () => void; deletionCalls: number };
    state.deletionCalls = 0;
    LibraryDb.prototype.permanentlyDeleteFromTrash = async function (plan) {
      state.deletionCalls++;
      await new Promise<void>(resolve => { state.releaseDeletion = resolve; });
      await original.call(this, plan);
      throw new Error('Synthetic lost completion response');
    };
  });
  await page.locator('#trash-delete-commit').click();
  await expect(page.locator('#trash-delete-cancel')).toBeDisabled();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#trash-delete-dialog')).toBeVisible();
  await page.locator('#trash-delete-commit').dispatchEvent('click');
  expect(await page.evaluate(() => (window as unknown as { deletionCalls: number }).deletionCalls)).toBe(1);
  await page.evaluate(() => (window as unknown as { releaseDeletion: () => void }).releaseDeletion());
  await expect(page.locator('#trash-delete-status')).toContainText('完全に削除しました');
  await expect(page.locator('#trash-delete-commit')).toBeHidden();
});

test('committed delete with a later render failure never offers a delete retry', async ({ page }) => {
  await openVerifiedDelete(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    const original = LibraryDb.prototype.permanentlyDeleteFromTrash;
    LibraryDb.prototype.permanentlyDeleteFromTrash = async function (plan) {
      await original.call(this, plan);
      const list = LibraryDb.prototype.listPhotos;
      LibraryDb.prototype.listPhotos = async function () { LibraryDb.prototype.listPhotos = list; throw new Error('Synthetic render failure'); };
    };
  });
  await page.locator('#trash-delete-commit').click();
  await expect(page.locator('#trash-delete-status')).toContainText('削除は確定しましたが、表示を更新できません');
  await expect(page.locator('#trash-delete-commit')).toBeHidden(); await expect(page.locator('#trash-delete-check')).toBeHidden();
  await expect(page.locator('#trash-delete-cancel')).toHaveText('閉じる');
});

test('a concurrent change keeps its reason during result checks and never resends deletion', async ({ page }) => {
  await openVerifiedDelete(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const { newTrip } = await import('../../src/domain/model');
    const db = await LibraryDb.open(); await db.createTrip(newTrip('確認中の別画面の変更')); db.close();
  });
  await page.locator('#trash-delete-commit').click();
  await expect(page.locator('#trash-delete-status')).toContainText('確認後に保存内容が変わりました');
  await expect(page.locator('#trash-delete-status')).toContainText('自動では再送しません');
  await expect(page.locator('#trash-delete-check')).toBeEnabled(); await page.locator('#trash-delete-check').click();
  await expect(page.locator('#trash-delete-status')).toContainText('確認後に保存内容が変わりました');
  await expect(page.locator('#trash-delete-commit')).toBeHidden();
});
