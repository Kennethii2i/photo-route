import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function state(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const snapshot = await db.snapshot(), history = await db.listRecovery(); db.close();
    return { links: snapshot.links, photos: snapshot.photos, visits: snapshot.visits, history };
  });
}
async function albumSave(page: Page, albumId: string, photoId: string) {
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list [data-visit-id="${albumId}"]`).click();
  await page.getByRole('button', { name: '写真を選択', exact: true }).click();
  const check = page.locator(`#vpe-list [data-tile-id="${photoId}"] input[type=checkbox]`);
  await page.locator('#vpe-search').fill('街並み-23.jpg'); await check.check();
  await page.locator('#vpe-save').click(); await expect(page.locator('#vpe-undo')).toBeVisible();
  await expect(page.locator('#undo-notice')).toBeHidden();
  await page.locator('#vpe-close').click(); await expect(page.locator('#undo-notice-action')).toBeVisible();
}
async function screenshot(page: Page, name: string) {
  mkdirSync('specs/ux-r9/screenshots', { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const notice = await page.locator('#undo-notice').boundingBox(); expect(notice).not.toBeNull();
  for (const id of ['#map-navigation', '#mobile-tabs', '#right-close']) {
    const control = page.locator(id);
    if (!await control.isVisible()) continue;
    const rect = (await control.boundingBox())!;
    expect(notice!.x < rect.x + rect.width && notice!.x + notice!.width > rect.x && notice!.y < rect.y + rect.height && notice!.y + notice!.height > rect.y).toBe(false);
  }
  await page.screenshot({ path: `specs/ux-r9/screenshots/${name}.png`, animations: 'disabled' });
}

test('R9 confirmed album change offers one notice and Undo retains filters map mode and mobile navigation', async ({ page }) => {
  const ids = await seedUi(page), before = await state(page);
  await page.locator('#photo-search').fill('海辺');
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await albumSave(page, ids.albums[0]!, ids.photos[22]!);
  await expect(page.locator('#undo-notice-status')).toHaveText('アルバムの写真を変更しました');
  expect((await state(page)).links.length).toBe(before.links.length + 1);
  await screenshot(page, 'ux-r9-pc1440-undo');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await screenshot(page, `ux-r9-mobile${width}-undo`);
  }
  const tab = await page.locator('body').getAttribute('data-mobile-tab');
  await page.locator('#undo-notice-action').click(); await expect(page.locator('#undo-notice-status')).toHaveText('元に戻しました');
  const after = await state(page); expect(after.links).toEqual(before.links); expect(after.photos).toEqual(before.photos); expect(after.visits).toEqual(before.visits);
  expect(after.history.at(-1)?.undoneAt).not.toBeNull(); await expect(page.locator('#photo-search')).toHaveValue('海辺');
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', tab!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#drawer-toggle')).toHaveAttribute('aria-expanded', 'false'); await page.locator('#drawer-toggle').click();
  await albumSave(page, ids.albums[0]!, ids.photos[22]!); await expect(page.locator('#undo-notice')).toHaveCount(1);
  await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const album = (await db.listVisits()).find(item => item.id === id)!;
    await db.updateVisit({ ...album, label: '後続の編集', updatedAt: new Date().toISOString() }); db.close();
  }, ids.albums[1]!);
  const subsequent = await state(page); await expect(page.locator('#undo-notice')).toBeHidden();
  expect(await state(page)).toEqual(subsequent);
});

test('R9 photo-side notice closes without deleting history and unknown saves never offer Undo', async ({ page }) => {
  const ids = await seedUi(page);
  await page.locator('#photo-search').fill('海辺-1.jpg'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await page.locator('#photo-album-edit-open').click();
  await page.locator(`#pae-list [data-album-id="${ids.albums[1]}"] input`).check(); await page.locator('#pae-save').click();
  await expect(page.locator('#pae-undo')).toBeVisible(); await expect(page.locator('#undo-notice')).toBeHidden();
  await page.locator('#pae-close').click(); await expect(page.locator('#undo-notice-status')).toHaveText('写真のアルバムを変更しました');
  const saved = await state(page); await page.locator('#undo-notice-close').click();
  await expect(page.locator('#undo-notice')).toBeHidden(); expect(await state(page)).toEqual(saved);
  await page.locator('#header-manage').click(); await expect(page.locator('#undo-button')).toBeEnabled();
  await page.locator('#undo-button').click(); await expect.poll(async () => (await state(page)).links.length).toBe(saved.links.length - 1);
  await page.locator('#management-close').click(); await page.locator('#photo-album-edit-open').click();
  await expect(page.locator('#photo-album-editor')).toBeVisible();
  await page.locator(`#pae-list [data-album-id="${ids.albums[1]}"] input`).check();
  const beforeUnknown = await state(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    LibraryDb.prototype.saveAlbumMembershipBatch = async () => { throw new Error('synthetic response loss'); };
    LibraryDb.prototype.albumMembershipOperationStatus = async () => 'unknown';
  });
  await page.locator('#pae-save').click(); await expect(page.locator('#pae-conflict')).toBeVisible();
  await expect(page.locator('#undo-notice')).toBeHidden();
  expect(await state(page)).toEqual(beforeUnknown);
});

test('R9 target ID check atomically rejects a different tab write and existing conflict checks remain enforced', async ({ page }) => {
  const ids = await seedUi(page); await albumSave(page, ids.albums[0]!, ids.photos[22]!);
  const saved = await state(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const undo = LibraryDb.prototype.undoLatest;
    LibraryDb.prototype.undoLatest = async function (expected) {
      await new Promise<void>(resolve => { Object.assign(window, { __releaseUndo: resolve }); });
      return undo.call(this, expected);
    };
  });
  await page.locator('#undo-notice-action').click(); await page.waitForFunction(() => '__releaseUndo' in window);
  const other = await page.context().newPage(); const origin = new URL(page.url()).origin;
  await other.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  await other.goto('/');
  await other.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const album = (await db.listVisits()).find(item => item.id === id)!;
    await db.updateVisit({ ...album, label: '別タブの編集', updatedAt: new Date().toISOString() }); db.close();
  }, ids.albums[1]!);
  const changed = await state(page); await page.evaluate(() => (window as unknown as { __releaseUndo(): void }).__releaseUndo());
  await expect(page.locator('#undo-notice-status')).toContainText('元に戻せません'); await expect(page.locator('#undo-notice-action')).toBeHidden();
  expect(await state(page)).toEqual(changed); expect(changed.links).toEqual(saved.links);
  // The stale ID also rejects direct calls, while an ID match still runs the original relationship checks.
  const result = await other.evaluate(async ({ oldId, photoId }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    let staleRejected = false; try { await db.undoLatest(oldId); } catch { staleRejected = true; }
    await db.undoLatest(); // Existing management semantics are unchanged.
    const photo = (await db.listPhotos()).find(item => item.id === photoId)!;
    const request = indexedDB.open('photo-route-library');
    const raw = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = raw.transaction('photos', 'readwrite'); tx.objectStore('photos').put({ ...photo, originalFilename: 'synthetic-conflict.jpg' });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); raw.close();
    let conflictRejected = false; try { await db.undoLatest(oldId); } catch { conflictRejected = true; }
    const links = await db.listPhotoAlbumLinks(), history = await db.listRecovery(); db.close();
    return { staleRejected, conflictRejected, links, history };
  }, { oldId: saved.history.at(-1)!.id, photoId: ids.photos[22]! });
  expect(result.staleRejected).toBe(true); expect(result.conflictRejected).toBe(true); expect(result.links).toEqual(saved.links);
  expect(result.history.find(item => item.id === saved.history.at(-1)!.id)?.undoneAt).toBeNull();
  await other.close();
});
