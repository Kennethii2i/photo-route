import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { seedUi } from './helpers/ui-package';

const stable = '60344b6015eaa487e1fc6108aa41de758999e425';
test.setTimeout(60_000);
test.use({ actionTimeout: 7_000 });
test.beforeAll(() => {
  // Read historical source without checking out, altering, or running the user's stable environment.
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', stable, 'src'], { encoding: 'utf8' }).trim().split('\n');
  for (const path of paths) {
    const target = join('test-results/rc1-legacy', path.trim()); mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, new Uint8Array(execFileSync('git', ['show', `${stable}:${path.trim()}`])));
  }
});

async function isolated(page: Page) {
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin === 'https://tiles.openfreemap.org' && url.pathname.startsWith('/styles/'))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [] }) });
    return route.abort('blockedbyclient');
  });
  await page.goto('/');
}

test('RC1 genuine stable v2 database migration and genuine v1 archive preserve 60 photos', async ({ page }) => {
  await isolated(page);
  const result = await page.evaluate(async () => {
    const { seedRcDb, fingerprint } = await import('../../tests/e2e/helpers/rc1-data');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { restoreArchive } = await import('../../src/infrastructure/archive');
    const path = '/test-results/rc1-legacy/src/infrastructure/archive.ts';
    const oldArchive = await import(/* @vite-ignore */ path) as typeof import('../../src/infrastructure/archive');
    const name = `rc1-genuine-v2-${crypto.randomUUID()}`;
    const old = await seedRcDb(name, true);
    const before = await fingerprint(old.db), history = await old.db.listRecovery();
    const zip = await oldArchive.exportArchive(await old.db.snapshot());
    old.db.close();
    const migrated = await LibraryDb.open(name);
    const after = await fingerprint(migrated), afterHistory = await migrated.listRecovery();
    migrated.close();
    const oldOpen = indexedDB.open(name, 2);
    const downgradeError = await new Promise<string>(resolve => {
      oldOpen.onerror = () => resolve(oldOpen.error!.name);
      oldOpen.onsuccess = () => { oldOpen.result.close(); resolve('unexpected-success'); };
    });
    const target = await LibraryDb.open(`rc1-v1-restore-${crypto.randomUUID()}`);
    const restored = await restoreArchive(target, zip);
    const imported = await fingerprint(target), importedHistory = await target.listRecovery(); target.close();
    const reopened = await LibraryDb.open(name);
    const reopenedLinks = await reopened.listPhotoAlbumLinks(); reopened.close();
    return { before, after, history, afterHistory, imported, importedHistory, restored, downgradeError,
      reopenedLinks, trashedAlbum: old.albums[2], v1Bytes: Array.from(new Uint8Array(await zip.arrayBuffer())) };
  });
  const expectedPhotos = result.before.photos.map(photo => ({ ...photo, visitId: null }));
  const expectedLinks = result.before.photos.filter(photo => photo.visitId).map(photo => ({ albumId: photo.visitId!, photoId: photo.id, createdAt: null }))
    .sort((a, b) => `${a.albumId}:${a.photoId}`.localeCompare(`${b.albumId}:${b.photoId}`));
  const expected = { ...result.before, photos: expectedPhotos, links: expectedLinks };
  expect(result.before.trips).toHaveLength(2); expect(result.before.visits).toHaveLength(4);
  expect(result.before.photos).toHaveLength(60); expect(result.before.thumbnails).toHaveLength(60);
  expect(result.after).toEqual(expected); expect(result.imported).toEqual(expected);
  expect(result.reopenedLinks).toEqual(result.after.links);
  expect(result.after.links.some(link => link.albumId === result.trashedAlbum)).toBe(true);
  expect(result.history.length).toBeGreaterThan(0); expect(result.afterHistory).toEqual(result.history);
  expect(result.importedHistory).toEqual([]); // Undo history is deliberately outside the archive format.
  expect(result.restored).toMatchObject({ state: 'imported', trips: 2, photos: 60 });
  expect(result.downgradeError).toBe('VersionError');
  const v1 = new Uint8Array(result.v1Bytes), entries = unzipSync(v1);
  expect(JSON.parse(Buffer.from(entries['manifest.json']!).toString()).version).toBe(1);
  writeFileSync(test.info().outputPath('genuine-stable-v1.zip'), v1);
  await test.info().attach('migration-comparison', { body: JSON.stringify({ stable, photos: 60, thumbnails: 60,
    links: expectedLinks.length, legacyHistory: result.history.length, v1Bytes: v1.length, downgradeError: result.downgradeError }), contentType: 'application/json' });
});

test('RC1 normal UI downloads v2, restores into a fresh DB, remaps copies and rejects corruption atomically', async ({ page, browser }) => {
  await isolated(page);
  const source = await page.evaluate(async () => {
    const { seedRcDb, fingerprint } = await import('../../tests/e2e/helpers/rc1-data');
    const fixture = await seedRcDb('photo-route-library');
    const snapshot = await fingerprint(fixture.db); fixture.db.close(); return snapshot;
  });
  await page.reload(); await page.locator('#header-manage').click();
  const pending = page.waitForEvent('download'); await page.locator('#export-button').click();
  const download = await pending; expect(await download.failure()).toBeNull();
  const destination = test.info().outputPath('rc1-saved-v2.zip'); await download.saveAs(destination);
  const bytes = new Uint8Array(readFileSync(destination)), entries = unzipSync(bytes);
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString());
  expect(manifest.version).toBe(2); expect(entries['records/photo-album-links.json']).toBeDefined();
  expect(source.photos).toHaveLength(60); expect(source.thumbnails).toHaveLength(60);
  expect(source.links.filter(link => link.photoId === source.photos.find(photo => photo.originalFilename === 'rc1-003.jpg')!.id)).toHaveLength(2);
  const fresh = await browser.newContext();
  try {
    const target = await fresh.newPage(); await isolated(target); await target.locator('#header-manage').click();
    await expect(target.locator('#restore-button')).toBeDisabled();
    await target.locator('#archive-file').setInputFiles(destination); await target.locator('#restore-button').click();
    await expect(target.locator('#archive-status')).toContainText('2件の旅行と60件の写真を復元');
    const restored = await target.evaluate(async () => {
      const { fingerprint } = await import('../../tests/e2e/helpers/rc1-data'); const { LibraryDb } = await import('../../src/infrastructure/storage');
      const db = await LibraryDb.open(); const snapshot = await fingerprint(db), history = await db.listRecovery(); db.close(); return { snapshot, history };
    });
    expect(restored.snapshot).toEqual(source); expect(restored.history).toEqual([]);
    // A valid ZIP container with a changed record and unchanged manifest must fail checksum validation.
    const { zipSync } = await import('fflate');
    const damaged = { ...entries, 'records/photos.json': new TextEncoder().encode('[]') };
    await target.locator('#archive-file').setInputFiles({ name: 'rc1-corrupt.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(damaged)) });
    await target.locator('#restore-button').click(); await expect(target.locator('#archive-status')).toContainText('復元を拒否');
    const copy = await target.evaluate(async raw => {
      const { fingerprint } = await import('../../tests/e2e/helpers/rc1-data'); const { LibraryDb } = await import('../../src/infrastructure/storage');
      const { restoreArchive, previewArchiveRestore } = await import('../../src/infrastructure/archive');
      const db = await LibraryDb.open();
      const afterCorrupt = await fingerprint(db), recoveryAfterCorrupt = await db.listRecovery();
      const trip = (await db.listTrips()).find(trip => trip.name === 'RC-1 合成旅行')!;

      const album = (await db.listVisits()).find(album => album.tripId === trip.id && album.label === '港の散歩')!;
      await db.updateVisit({ ...album, label: '変更したアルバム名' });
      const beforeCopy = await fingerprint(db);
      const blob = new Blob([new Uint8Array(raw)], { type: 'application/zip' });
      const preview = await previewArchiveRestore(db, blob), outcome = await restoreArchive(db, blob, 'copy-conflicts');
      const afterCopy = await fingerprint(db); db.close();
      return { afterCorrupt, recoveryAfterCorrupt, beforeCopy, afterCopy, preview, outcome };
    }, Array.from(bytes));
    expect(copy.afterCorrupt).toEqual(source); expect(copy.recoveryAfterCorrupt).toEqual([]);
    expect(copy.preview.conflictingTrips).toBe(1); expect(copy.outcome).toMatchObject({ state: 'imported', trips: 1, photos: 54 });
    for (const field of ['trips', 'visits', 'photos', 'thumbnails', 'links'] as const)
      for (const record of copy.beforeCopy[field]) expect(copy.afterCopy[field]).toContainEqual(record);
    const copiedTrip = copy.afterCopy.trips.find(trip => trip.name.endsWith('（復元コピー）'))!;
    expect(source.trips.some(trip => trip.id === copiedTrip.id)).toBe(false);
    const copiedPhotos = copy.afterCopy.photos.filter(photo => photo.tripId === copiedTrip.id);
    const albumById = new Map(copy.afterCopy.visits.map(album => [album.id, album]));
    const sourceAlbumById = new Map(source.visits.map(album => [album.id, album]));
    for (const photo of copiedPhotos) {
      const original = source.photos.find(item => item.originalFilename === photo.originalFilename)!;
      expect(photo.id).not.toBe(original.id); expect(photo.thumbnailId).not.toBe(original.thumbnailId);
      expect(photo).toEqual({ ...original, id: photo.id, tripId: copiedTrip.id, thumbnailId: photo.thumbnailId });
      const thumb = copy.afterCopy.thumbnails.find(item => item.id === photo.thumbnailId)!;
      const originalThumb = source.thumbnails.find(item => item.id === original.thumbnailId)!;
      expect(thumb).toEqual({ ...originalThumb, id: photo.thumbnailId, photoId: photo.id });
      const originalLinks = source.links.filter(link => link.photoId === original.id);
      const copiedLinks = copy.afterCopy.links.filter(link => link.photoId === photo.id);
      expect(copiedLinks.map(link => ({ label: albumById.get(link.albumId)!.label, createdAt: link.createdAt })).sort((a, b) => a.label.localeCompare(b.label)))
        .toEqual(originalLinks.map(link => ({ label: sourceAlbumById.get(link.albumId)!.label, createdAt: link.createdAt })).sort((a, b) => a.label.localeCompare(b.label)));
      for (const link of copiedLinks) {
        const album = albumById.get(link.albumId)!; expect(album.tripId).toBe(copiedTrip.id);
        expect(source.visits.some(item => item.id === album.id)).toBe(false);
        const originalAlbum = sourceAlbumById.get(originalLinks.find(item => sourceAlbumById.get(item.albumId)!.label === album.label)!.albumId)!;
        expect(album).toEqual({ ...originalAlbum, id: album.id, tripId: copiedTrip.id });
      }
    }
    await test.info().attach('zip-results', { body: JSON.stringify({ bytes: bytes.length, photos: 60, thumbnails: 60,
      links: source.links.length, copyPhotos: copiedPhotos.length, manifestVersion: manifest.version }), contentType: 'application/json' });
  } finally { await fresh.close(); }
});

test('RC1 continuous UI photo display, batch add/remove, Undo, album search, photo filter and map return', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seedUi(page, { searchScenario: true });
  const original = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const snapshot = await db.snapshot(); db.close(); return snapshot;
  });
  // Offscreen virtual tiles are intentionally absent; use the normal search entry point.
  await page.locator('#photo-search').fill('海辺-1.jpg');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await expect(page.getByRole('button', { name: '詳細を見る', exact: true })).toBeVisible(); await page.locator('#right-close').click();
  await page.locator('#photo-search').fill('');
  await page.locator('#left-tab-visits').click(); await page.locator('#album-search').fill('港と街');
  await expect(page.locator('#visit-list button')).toHaveCount(2); await page.locator('#album-search').fill('');
  await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  const toggle = (id: string) => page.locator(`.vpe-tile[data-tile-id="${id}"] input`);
  await page.locator('#vpe-search').fill('海辺-1.jpg'); await toggle(ids.photos[0]!).uncheck();
  await page.locator('#vpe-search').fill('街並み-2.jpg'); await toggle(ids.photos[1]!).check();
  await page.locator('#vpe-save').click(); await expect(page.locator('#vpe-status')).toContainText('1枚追加、1枚解除しました');
  const saved = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const links = await db.listPhotoAlbumLinks(); db.close(); return links;
  });
  expect(saved.some(link => link.albumId === ids.albums[0] && link.photoId === ids.photos[0])).toBe(false);
  expect(saved.some(link => link.albumId === ids.albums[0] && link.photoId === ids.photos[1])).toBe(true);
  expect(saved.some(link => link.albumId === ids.albums[1] && link.photoId === ids.photos[1])).toBe(true);
  expect(saved.some(link => link.albumId === ids.albums[3] && link.photoId === ids.photos[0])).toBe(true);
  await page.locator('#vpe-undo').click(); await expect(page.locator('#vpe-status')).toContainText('Undoしました');
  await page.locator('#vpe-close').click(); await expect(page.locator('#visit-summary')).toBeVisible();
  await page.locator('#right-close').click(); await page.locator('#left-tab-photos').click();
  await page.locator('#photo-filter-more > summary').click(); await page.locator('#photo-visit-filter').selectOption(`album:${ids.albums[3]}`);
  await expect(page.locator('#photo-count')).toContainText('1件');
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts'); const original = PhotoMap.prototype.update;
    PhotoMap.prototype.update = function (...args) {
      original.apply(this, args); Object.assign(window, { __rcMap: args[0].map(photo => photo.id) });
    };
  });
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[1]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await expect.poll(() => page.evaluate(() => [...((window as unknown as { __rcMap?: string[] }).__rcMap ?? [])].sort()))
    .toEqual(original.links!.filter(link => link.albumId === ids.albums[1]).map(link => link.photoId).sort());
  await page.locator('#visit-focus-exit').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __rcMap?: string[] }).__rcMap)).toEqual([ids.photos[0]]);
  await page.locator('#left-tab-photos').click(); await expect(page.locator('#photo-visit-filter')).toHaveValue(`album:${ids.albums[3]}`);
  await page.locator('#photo-gps-filter').selectOption('none'); await expect(page.locator('#photo-count')).toContainText('0件');
  const after = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const snapshot = await db.snapshot(); db.close(); return snapshot;
  });
  expect(after).toEqual(original);
});
