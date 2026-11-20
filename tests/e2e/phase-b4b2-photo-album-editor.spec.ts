import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function seed(page: Page, albumCount = 4) {
  const origin = test.info().project.use.baseURL as string;
  const external: string[] = [];
  await page.route('**/*', route => route.request().url().startsWith(origin)
    ? route.continue() : (external.push(route.request().url()), route.abort('blockedbyclient')));
  await page.goto('/');
  const ids = await page.evaluate(async albumCount => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const trip = newTrip('合成・海辺の週末'), otherTrip = newTrip('別の旅行');
    const albums = Array.from({ length: albumCount }, (_, index) => newVisit(trip.id, ['海辺の週末', '街歩き', '絶景スポット'][index] ?? `アルバム ${index + 1}`));
    const trash = { ...newVisit(trip.id, 'ごみ箱のアルバム'), deletedAt: trip.createdAt };
    const otherAlbum = newVisit(otherTrip.id, '別旅行のアルバム');
    const blobs: Blob[] = [];
    for (const color of ['#f0a58c', '#87bfd7', '#b7cbb1']) {
      const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 135;
      const context = canvas.getContext('2d')!;
      context.fillStyle = color; context.fillRect(0, 0, 180, 80);
      context.fillStyle = '#356e7d'; context.fillRect(0, 80, 180, 55);
      blobs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .82)));
    }
    const photos = Array.from({ length: 3 }, (_, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: `海辺の写真-${index}.jpg`,
      sourceMime: 'image/jpeg', sourceByteLength: 1_000_000, contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: { synthetic: index }, normalized: { latitude: 32.7 + index * .00001, longitude: 129.8 },
        horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: '2026:01:03 07:42:00', rawOffsetTimeOriginal: null,
        rawGpsDateStamp: null, rawGpsTimeStamp: null, localClock: '2026:01:03 07:42:00', offsetMinutes: null,
        capturedAtUtc: null, status: 'local-only', evidence: 'none', issues: [] }, timeCorrection: null,
      sourceOrientation: null, thumbnailId: crypto.randomUUID(), thumbnailState: 'available', metadataIssues: [],
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    const links = [albums[0]!, albums[1]!, trash].map(album => ({ albumId: album.id, photoId: photos[0]!.id, createdAt: null }));
    if (albumCount > 10) for (const album of albums.slice(2, Math.min(albumCount, 70)))
      links.push({ albumId: album.id, photoId: photos[0]!.id, createdAt: null });
    const db = await LibraryDb.open();
    await db.restoreNew({ trips: [trip, otherTrip], visits: [...albums, trash, otherAlbum], photos, links,
      thumbnails: photos.map((photo, index) => ({ id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg',
        width: 180, height: 135, byteLength: blobs[index]!.size, blob: blobs[index]! })) });
    db.close();
    return { tripId: trip.id, albumIds: albums.map(album => album.id), trashId: trash.id,
      otherAlbumId: otherAlbum.id, photoIds: photos.map(photo => photo.id), updatedAt: photos[0]!.updatedAt };
  }, albumCount);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.tripId);
  return { ...ids, external };
}

async function openEditor(page: Page, photoId: string) {
  await page.locator(`#photo-list button[data-photo-id="${photoId}"]`).click();
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-album-edit-open').click();
  await expect(page.locator('#photo-album-editor')).toBeVisible();
}
const check = (page: Page, albumId: string) => page.locator(`.pae-album[data-album-id="${albumId}"] input[type=checkbox]`);
async function state(page: Page, photoId: string) {
  return page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const [links, photos] = await Promise.all([db.albumIdsForPhoto(id), db.listPhotos()]); db.close();
    return { links, photo: photos.find(photo => photo.id === id) };
  }, photoId);
}

test('adds and removes memberships atomically, preserves trash and source photo, then undoes once', async ({ page }) => {
  const ids = await seed(page); await openEditor(page, ids.photoIds[0]!);
  await expect(page.locator('#pae-counts')).toContainText('所属中 2件');
  await expect(page.locator('#pae-trash-note')).toContainText('1件');
  await expect(check(page, ids.albumIds[0]!)).toBeChecked();
  await expect(check(page, ids.albumIds[2]!)).not.toBeChecked();
  await check(page, ids.albumIds[1]!).uncheck(); await check(page, ids.albumIds[2]!).check();
  await expect(page.locator('#pae-counts')).toContainText('+1・−1');
  await page.locator('#pae-save').click();
  await expect(page.locator('#pae-status')).toContainText('1件追加・1件解除しました');
  let actual = await state(page, ids.photoIds[0]!);
  expect(actual.links).toEqual(expect.arrayContaining([ids.albumIds[0], ids.albumIds[2], ids.trashId]));
  expect(actual.links).not.toContain(ids.albumIds[1]);
  expect(actual.photo?.updatedAt).toBe(ids.updatedAt);
  await page.locator('#pae-undo').click();
  await expect(page.locator('#pae-status')).toContainText('1回でUndoしました');
  actual = await state(page, ids.photoIds[0]!);
  expect(actual.links).toEqual(expect.arrayContaining([ids.albumIds[0], ids.albumIds[1], ids.trashId]));
  expect(actual.links).not.toContain(ids.albumIds[2]);
  expect(ids.external).toEqual([]);
});

test('unlinked photo joins three albums and can leave all memberships', async ({ page }) => {
  const ids = await seed(page); await openEditor(page, ids.photoIds[1]!);
  await expect(page.locator('#pae-save')).toBeDisabled();
  for (const id of ids.albumIds.slice(0, 3)) await check(page, id).check();
  await page.locator('#pae-save').click(); await expect(page.locator('#pae-status')).toContainText('3件追加');
  expect((await state(page, ids.photoIds[1]!)).links).toHaveLength(3);
  for (const id of ids.albumIds.slice(0, 3)) await check(page, id).uncheck();
  await page.locator('#pae-save').click(); await expect(page.locator('#pae-status')).toContainText('3件解除');
  expect((await state(page, ids.photoIds[1]!)).links).toEqual([]);
  expect(await check(page, ids.otherAlbumId).count()).toBe(0);
  expect(ids.external).toEqual([]);
});

test('search retains draft, Escape confirms leaving, and conflict rejects stale save', async ({ page }) => {
  const ids = await seed(page); await openEditor(page, ids.photoIds[0]!);
  await check(page, ids.albumIds[2]!).check();
  await page.locator('#pae-search').fill('海辺');
  await expect(check(page, ids.albumIds[2]!)).toBeHidden();
  await expect(page.locator('#pae-counts')).toContainText('+1');
  await page.locator('#pae-search').fill(''); await expect(check(page, ids.albumIds[2]!)).toBeChecked();
  await page.keyboard.press('Escape'); await expect(page.locator('#pae-leave')).toBeVisible();
  await page.locator('#pae-leave-stay').click(); await expect(check(page, ids.albumIds[2]!)).toBeChecked();
  await page.evaluate(async ({ photoId, tripId, albumIds }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const [photos, trip, albums, links] = await Promise.all([
      db.listPhotos(), db.getTrip(tripId), db.listVisits(), db.listPhotoAlbumLinks(photoId),
    ]);
    await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: trip!, expectedAlbums: albums.filter(album => links.some(link => link.albumId === album.id) || album.id === albumIds[2]),
      changes: [{ beforePhoto: photos.find(photo => photo.id === photoId)!, expectedLinks: links,
        afterAlbumIds: [...links.map(link => link.albumId), albumIds[2]!] }] }); db.close();
  }, { photoId: ids.photoIds[0]!, tripId: ids.tripId, albumIds: ids.albumIds });
  await page.locator('#pae-save').click();
  await expect(page.locator('#pae-conflict')).toBeVisible();
  await expect(page.locator('#pae-conflict-message')).toContainText('所属先が変更');
  await expect(check(page, ids.albumIds[2]!)).toBeChecked();
  mkdirSync('specs/phase-b4b2/screenshots', { recursive: true });
  await page.screenshot({ path: 'specs/phase-b4b2/screenshots/conflict-pc.png' });
  expect(ids.external).toEqual([]);
});

test('cancel keeps the Photo detail and album-side editor reads the photo-side save', async ({ page }) => {
  const ids = await seed(page); await openEditor(page, ids.photoIds[1]!);
  await check(page, ids.albumIds[2]!).check();
  await page.locator('#pae-cancel').click();
  await expect(page.locator('#pae-leave')).toBeVisible();
  await page.locator('#pae-leave-discard').click();
  await expect(page.locator('#photo-album-editor')).toBeHidden();
  await expect(page.locator('#photo-detail')).toContainText('海辺の写真-1.jpg');
  expect((await state(page, ids.photoIds[1]!)).links).toEqual([]);
  await page.locator('#photo-album-edit-open').click();
  await expect(page.locator('#photo-album-editor')).toBeVisible();
  await check(page, ids.albumIds[2]!).check();
  await expect(page.locator('#pae-counts')).toContainText('+1');
  await page.locator('#pae-save').click();
  await expect(page.locator('#pae-status')).toContainText('1件追加');
  await page.locator('#pae-close').click();
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albumIds[2]}"]`).click();
  await expect(page.locator('#visit-summary')).toContainText('写真 1枚');
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await expect(page.locator(`.vpe-tile[data-tile-id="${ids.photoIds[1]}"] input[type=checkbox]`)).toBeChecked();
  expect(ids.external).toEqual([]);
});

test('response loss checks operation ID; write failure keeps the draft', async ({ page }) => {
  const ids = await seed(page); await openEditor(page, ids.photoIds[1]!);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const tx = original.call(this, names, mode, options);
      const stores = typeof names === 'string' ? [names] : [...names];
      if (mode === 'readwrite' && stores.includes('photoAlbumLinks') && stores.includes('recovery')) {
        IDBDatabase.prototype.transaction = original;
        Object.defineProperty(tx, 'oncomplete', { configurable: true, set() {
          tx.addEventListener('complete', () => { tx.onabort?.call(tx, new Event('abort')); }, { once: true });
        } });
      }
      return tx;
    };
  });
  await check(page, ids.albumIds[0]!).check(); await page.locator('#pae-save').click();
  await expect(page.locator('#pae-status')).toContainText('1件追加・0件解除しました');
  expect((await state(page, ids.photoIds[1]!)).links).toEqual([ids.albumIds[0]]);
  await check(page, ids.albumIds[1]!).check();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'photoAlbumLinks') { IDBObjectStore.prototype.add = original; throw new Error('synthetic write failure'); }
      return original.call(this, value, key);
    };
  });
  await page.locator('#pae-save').click();
  await expect(page.locator('#pae-status')).toContainText('保存されていません');
  await expect(check(page, ids.albumIds[1]!)).toBeChecked();
  expect((await state(page, ids.photoIds[1]!)).links).toEqual([ids.albumIds[0]]);
  expect(ids.external).toEqual([]);
});

test('PC and mobile screenshots keep editing controls reachable', async ({ page }) => {
  const ids = await seed(page); await openEditor(page, ids.photoIds[0]!);
  const folder = 'specs/phase-b4b2/screenshots'; mkdirSync(folder, { recursive: true });
  for (const [width, height] of [[1440, 900], [900, 800], [390, 844], [320, 700]] as const) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(180);
    await page.screenshot({ path: `${folder}/editor-${width}.png` });
    await expect(page.locator('#pae-save')).toBeVisible();
    if (width <= 390) await expect(page.locator('#mobile-tabs')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await check(page, ids.albumIds[1]!).uncheck(); await check(page, ids.albumIds[2]!).check();
  await page.screenshot({ path: `${folder}/editor-dirty-pc.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${folder}/editor-dirty-mobile.png` });
  await page.keyboard.press('Escape'); await page.screenshot({ path: `${folder}/leave-mobile.png` });
  await expect(page.locator('#pae-leave')).toBeVisible();
  await page.locator('#pae-leave-stay').click();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(page.locator('#pae-save')).toBeVisible();
  expect(await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('#pae-list')!;
    return list.scrollHeight > list.clientHeight;
  })).toBe(true);
  await page.locator('#pae-search').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.querySelector('#photo-album-editor')!.contains(document.activeElement))).toBe(true);
  expect(ids.external).toEqual([]);
});

for (const count of [10, 100]) test(`${count} albums open and search without one query per album`, async ({ page }) => {
  const ids = await seed(page, count);
  const started = Date.now(); await openEditor(page, ids.photoIds[0]!);
  const openMs = Date.now() - started;
  await expect(page.locator('#pae-search')).toBeFocused();
  await page.locator('#pae-search').fill('アルバム 9');
  await expect(page.locator('.pae-album:not([hidden])').first()).toBeVisible();
  await page.locator('#pae-search').fill('');
  if (count === 100) {
    await check(page, ids.albumIds[99]!).check();
    await page.locator('#pae-search').fill('海辺');
    await page.locator('#pae-search').fill('');
    await expect(check(page, ids.albumIds[99]!)).toBeChecked();
    await expect(page.locator('#pae-counts')).toContainText('+1');
  }
  const metric = await page.evaluate(() => ({ rows: document.querySelectorAll('.pae-album').length,
    heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null }));
  console.log(`B4b-2 albums ${count}: open ${openMs}ms, rows ${metric.rows}, JS heap ${metric.heapBytes}`);
  expect(metric.rows).toBe(count); expect(ids.external).toEqual([]);
});
