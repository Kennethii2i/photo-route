import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function seed(page: Page, count = 5) {
  const origin = test.info().project.use.baseURL as string;
  const external: string[] = [];
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    const url = new URL(route.request().url());
    // Default basemap requests are fulfilled locally; unexpected egress still fails this test.
    if (url.origin === 'https://tiles.openfreemap.org' && url.pathname.startsWith('/styles/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efeb' } }] }) });
    external.push(route.request().url()); return route.abort('blockedbyclient');
  });
  await page.goto('/');
  const ids = await page.evaluate(async count => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const trip = newTrip('合成編集旅行'), otherTrip = newTrip('別の合成旅行');
    const albums = ['アルバムA', 'アルバムB', 'アルバムC', 'ごみ箱のアルバム'].map(name => newVisit(trip.id, name));
    albums[3] = { ...albums[3]!, deletedAt: trip.createdAt };
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 140;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#95c5d1'; context.fillRect(0, 0, 180, 80);
    context.fillStyle = '#317965'; context.fillRect(0, 80, 180, 60);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .82));
    const photos = Array.from({ length: count }, (_, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: `編集-${String(index).padStart(4, '0')}.jpg`,
      sourceMime: 'image/jpeg', sourceByteLength: 1_000_000, contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: { synthetic: index }, normalized: { latitude: 32.7 + index * .00001, longitude: 129.8 },
        horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: '2026:01:02 10:00:00', rawOffsetTimeOriginal: null, rawGpsDateStamp: null,
        rawGpsTimeStamp: null, localClock: '2026:01:02 10:00:00', offsetMinutes: null, capturedAtUtc: null,
        status: 'local-only', evidence: 'none', issues: [] }, timeCorrection: null, sourceOrientation: null,
      thumbnailId: count > 5 || index === 0 ? crypto.randomUUID() : null,
      thumbnailState: count > 5 || index === 0 ? 'available' : 'failed',
      metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    const extra = photoSchema.parse({ ...photos[0]!, id: crypto.randomUUID(), tripId: otherTrip.id,
      originalFilename: '別旅行.jpg', contentSha256: 'f'.repeat(64), thumbnailId: null, thumbnailState: 'failed' });
    const links = photos.flatMap((photo, index) => {
      const owners = count === 5 ? [
        [albums[0]!, albums[1]!, albums[2]!], [albums[0]!], [albums[1]!], [albums[3]!], [],
      ][index]! : albums.slice(0, 3);
      return owners.map(album => ({ albumId: album.id, photoId: photo.id, createdAt: null }));
    });
    const db = await LibraryDb.open();
    await db.restoreNew({ trips: [trip, otherTrip], visits: albums, photos: [...photos, extra], links,
      thumbnails: photos.filter(photo => photo.thumbnailId).map(photo => ({ id: photo.thumbnailId!, photoId: photo.id,
        mime: 'image/jpeg', width: 180, height: 140, byteLength: blob.size, blob })) });
    db.close();
    return { tripId: trip.id, albumIds: albums.map(album => album.id), photoIds: photos.map(photo => photo.id), extraId: extra.id };
  }, count);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.tripId);
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albumIds[0]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
  return { ...ids, external };
}

const check = (page: Page, photoId: string) => page.locator(`.vpe-tile[data-tile-id="${photoId}"] input[type="checkbox"]`);
const linksFor = async (page: Page, photoId: string) => page.evaluate(async id => {
  const { LibraryDb } = await import('../../src/infrastructure/storage');
  const db = await LibraryDb.open(); const result = await db.albumIdsForPhoto(id); db.close(); return result;
}, photoId);

test('adds and removes only target links, keeps other and trashed links, and undoes once', async ({ page }) => {
  const ids = await seed(page);
  await expect(page.locator('#vpe-counts')).toContainText('選択 2枚');
  await expect(check(page, ids.photoIds[0]!)).toBeChecked();
  await expect(check(page, ids.photoIds[2]!)).not.toBeChecked();
  await page.locator(`.vpe-tile[data-tile-id="${ids.photoIds[2]}"] .vpe-preview-button`).click();
  await expect(page.locator('#vpe-preview-source')).toContainText('アルバムB');
  await page.locator('#vpe-preview-close').click();
  await expect(check(page, ids.photoIds[2]!)).not.toBeChecked();
  await check(page, ids.photoIds[1]!).uncheck();
  await check(page, ids.photoIds[2]!).click({ position: { x: 10, y: 10 } });
  await check(page, ids.photoIds[3]!).check();
  await check(page, ids.photoIds[4]!).check();
  await expect(page.locator('#vpe-counts')).toContainText('追加 3枚 · 解除 1枚');
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('3枚追加、1枚解除しました');
  await expect(page.locator('#vpe-save')).toBeDisabled();
  expect(await linksFor(page, ids.photoIds[0]!)).toEqual(expect.arrayContaining(ids.albumIds.slice(0, 3)));
  expect(await linksFor(page, ids.photoIds[1]!)).toEqual([]);
  expect(await linksFor(page, ids.photoIds[2]!)).toEqual(expect.arrayContaining(ids.albumIds.slice(0, 2)));
  expect(await linksFor(page, ids.photoIds[3]!)).toEqual(expect.arrayContaining([ids.albumIds[0], ids.albumIds[3]]));
  expect(await linksFor(page, ids.photoIds[4]!)).toEqual([ids.albumIds[0]]);
  await expect(page.locator('#vpe-undo')).toBeEnabled();
  await page.locator('#vpe-undo').click();
  await expect(page.locator('#vpe-status')).toContainText('Undoしました');
  expect(await linksFor(page, ids.photoIds[1]!)).toEqual([ids.albumIds[0]]);
  expect(await linksFor(page, ids.photoIds[2]!)).toEqual([ids.albumIds[1]]);
  expect(await linksFor(page, ids.photoIds[3]!)).toEqual([ids.albumIds[3]]);
  expect(await linksFor(page, ids.photoIds[4]!)).toEqual([]);
  await expect(page.locator(`.vpe-tile[data-tile-id="${ids.extraId}"]`)).toHaveCount(0);
  expect(ids.external).toEqual([]);
});

test('search, preview and leave protection preserve draft; stale save rejects without partial links', async ({ page }) => {
  const ids = await seed(page);
  await check(page, ids.photoIds[2]!).check();
  await page.locator('#vpe-search').fill('編集-0002');
  await expect(page.locator('#vpe-counts')).toContainText('追加 1枚');
  await page.locator('#vpe-search').fill('');
  await expect(check(page, ids.photoIds[2]!)).toBeChecked();
  await page.locator('#vpe-close').click();
  await expect(page.locator('#vpe-leave')).toBeVisible();
  await page.locator('#vpe-leave-stay').click();
  await expect(check(page, ids.photoIds[2]!)).toBeChecked();
  await page.evaluate(async ({ tripId, albumId, photoId }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const [trip, albums, photos, links] = await Promise.all([db.getTrip(tripId), db.listVisits(), db.listPhotos(), db.listPhotoAlbumLinks(photoId)]);
    await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: trip!,
      expectedAlbums: albums.filter(album => album.id === albumId || links.some(link => link.albumId === album.id)),
      changes: [{ beforePhoto: photos.find(photo => photo.id === photoId)!, expectedLinks: links,
        afterAlbumIds: [...links.map(link => link.albumId), albumId] }] });
    db.close();
  }, { tripId: ids.tripId, albumId: ids.albumIds[0]!, photoId: ids.photoIds[2]! });
  await check(page, ids.photoIds[4]!).check();
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-conflict')).toBeVisible();
  await expect(page.locator('#vpe-conflict-reason')).toContainText('アルバム所属が変更');
  expect(await linksFor(page, ids.photoIds[4]!)).toEqual([]);
  await page.locator('#vpe-conflict-close').click();
  await expect(page.locator('#vpe-counts')).toContainText('追加 2枚');
  expect(ids.external).toEqual([]);
});

test('response loss is confirmed by operation ID without double save', async ({ page }) => {
  const ids = await seed(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const tx = original.call(this, names, mode, options);
      const stores = typeof names === 'string' ? [names] : [...names];
      if (mode === 'readwrite' && stores.includes('photoAlbumLinks') && stores.includes('recovery')) {
        IDBDatabase.prototype.transaction = original;
        Object.defineProperty(tx, 'oncomplete', { configurable: true, set() {
          tx.addEventListener('complete', () => {
            (window as Window & { syntheticResponseLost?: boolean }).syntheticResponseLost = true;
            tx.onabort?.call(tx, new Event('abort'));
          }, { once: true });
        } });
      }
      return tx;
    };
  });
  await check(page, ids.photoIds[4]!).check();
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('1枚追加、0枚解除しました');
  const history = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const entries = await db.listRecovery(); db.close(); return entries.filter(entry => entry.kind === 'photo-album-batch').length;
  });
  expect(history).toBe(1);
  expect(await page.evaluate(() => (window as Window & { syntheticResponseLost?: boolean }).syntheticResponseLost)).toBe(true);
  expect(await linksFor(page, ids.photoIds[4]!)).toEqual([ids.albumIds[0]]);
  expect(ids.external).toEqual([]);
});

test('write failure keeps draft and keyboard navigation stays in editor', async ({ page }) => {
  const ids = await seed(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'photoAlbumLinks') {
        IDBObjectStore.prototype.add = original;
        throw new Error('synthetic link write failure');
      }
      return original.call(this, value, key);
    };
  });
  await check(page, ids.photoIds[4]!).check();
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('保存されていません');
  await expect(check(page, ids.photoIds[4]!)).toBeChecked();
  expect(await linksFor(page, ids.photoIds[4]!)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#vpe-leave')).toBeVisible();
  await expect(page.locator('#vpe-leave-save')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#vpe-leave')).toBeHidden();
  await expect(check(page, ids.photoIds[4]!)).toBeChecked();
  expect(ids.external).toEqual([]);
});

test('mobile tab change asks before discarding a membership draft', async ({ page }) => {
  const ids = await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await check(page, ids.photoIds[4]!).check();
  await page.locator('#mobile-tab-photos').click();
  await expect(page.locator('#vpe-leave')).toBeVisible();
  await page.locator('#vpe-leave-stay').click();
  await expect(check(page, ids.photoIds[4]!)).toBeChecked();
  await page.locator('#mobile-tab-photos').click();
  await page.locator('#vpe-leave-discard').click();
  await expect(page.locator('#visit-photo-editor-overlay')).toBeHidden();
  expect(await linksFor(page, ids.photoIds[4]!)).toEqual([]);
  expect(ids.external).toEqual([]);
});

test('PC and mobile album editor remains usable without rendering all photos', async ({ page }) => {
  const ids = await seed(page);
  const folder = 'specs/c-ux2-1/screenshots'; mkdirSync(folder, { recursive: true });
  for (const [width, height] of [[1440, 900], [900, 800], [390, 844], [320, 700]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${folder}/editor-${width}.png` });
    await expect(page.locator('#vpe-save')).toBeVisible();
    await expect(page.locator('#vpe-cancel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator('#vpe-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await check(page, ids.photoIds[4]!).check();
  await page.locator('#vpe-cancel').click();
  await expect(page.locator('#vpe-leave')).toBeVisible();
  await page.locator('#vpe-leave-discard').click();
  await expect(page.locator('#visit-photo-editor-overlay')).toBeHidden();
  expect(await linksFor(page, ids.photoIds[4]!)).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  const many = await seed(page, 120);
  const initial = await page.locator('.vpe-tile').count();
  expect(initial).toBeLessThan(40);
  await page.locator('#vpe-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const target = many.photoIds[119]!;
  await page.locator('#vpe-search').fill('編集-0119');
  await check(page, target).focus();
  await page.keyboard.press('Space');
  await expect(check(page, target)).not.toBeChecked();
  await page.getByRole('button', { name: '編集-0119.jpgをプレビュー', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#vpe-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(check(page, target)).not.toBeChecked();
  await page.locator('#vpe-search').fill('');
  await page.locator('#vpe-search').fill('編集-0119');
  await expect(check(page, target)).not.toBeChecked();
  expect(await linksFor(page, target)).toEqual(expect.arrayContaining(many.albumIds.slice(0, 3)));
  await page.locator('#vpe-cancel').click();
  await page.locator('#vpe-leave-discard').click();
  expect(await linksFor(page, target)).toEqual(expect.arrayContaining(many.albumIds.slice(0, 3)));
  console.log('C-UX2.1 virtualization', { photos: 120, renderedTiles: initial });
  expect(ids.external).toEqual([]);
});

for (const count of [1000, 5000]) test(`editor virtualizes ${count} photos with three memberships`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    (window as Window & { thumbnailGets?: number }).thumbnailGets = 0;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'thumbnails') (window as Window & { thumbnailGets?: number }).thumbnailGets!++;
      return original.call(this, key);
    };
  });
  const started = Date.now();
  const ids = await seed(page, count);
  const openedMs = Date.now() - started;
  const metric = await page.evaluate(() => ({ dom: document.querySelectorAll('*').length,
    tiles: document.querySelectorAll('.vpe-tile').length,
    thumbnailGets: (window as Window & { thumbnailGets?: number }).thumbnailGets ?? null,
    heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null }));
  await expect(page.locator('#vpe-counts')).toContainText(`選択 ${count}枚`);
  await page.locator('.vpe-tile input[type="checkbox"]').first().uncheck();
  await expect(page.locator('#vpe-counts')).toContainText('解除 1枚');
  console.log(`B4b-1 ${count}: seed+open ${openedMs}ms, DOM ${metric.dom}, tiles ${metric.tiles}, thumbnail gets ${metric.thumbnailGets}, JS heap ${metric.heapBytes}`);
  expect(metric.tiles).toBeLessThan(100);
  expect(metric.thumbnailGets).toBeLessThan(100);
  expect(ids.external).toEqual([]);
});
