import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function state(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const { trips, photos, visits, links } = await db.snapshot(), history = await db.listRecovery(); db.close(); return { trips, photos, visits, links, history };
  });
}
async function photoTrash(page: Page, photoId: string) {
  await page.locator('#photo-search').fill('海辺-1.jpg'); await page.locator(`#photo-list [data-photo-id="${photoId}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await page.locator('#photo-advanced > summary').click();
  await page.locator('.photo-trash').click(); await page.locator('#trash-commit').click();
}
async function albumTrash(page: Page, albumId: string) {
  if (page.viewportSize()!.width <= 700) await page.locator('#mobile-tab-visits').click(); else await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list [data-visit-id="${albumId}"]`).click(); await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-delete').click(); await page.locator('#trash-commit').click();
}
async function shot(page: Page, name: string) {
  mkdirSync('specs/ux-r9-1/screenshots', { recursive: true });
  await expect(page.locator('#undo-notice-action')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const box = (await page.locator('#undo-notice').boundingBox())!;
  for (const id of ['#map-navigation', '#mobile-tabs']) if (await page.locator(id).isVisible()) {
    const control = (await page.locator(id).boundingBox())!;
    expect(box.x < control.x + control.width && box.x + box.width > control.x && box.y < control.y + control.height && box.y + box.height > control.y).toBe(false);
  }
  if (page.viewportSize()!.width <= 390) {
    expect((await page.locator('#undo-notice-status').boundingBox())!.height).toBeLessThan(44);
    expect(box.height).toBeLessThanOrEqual(64);
  }
  await page.screenshot({ path: `specs/ux-r9-1/screenshots/${name}.png`, animations: 'disabled' });
}

test('R9.1 photo trash offers its receipt; notice Undo restores metadata links list and map', async ({ page }) => {
  const ids = await seedUi(page), before = await state(page); await photoTrash(page, ids.photos[0]!);
  await expect(page.locator('#management-panel')).not.toBeVisible(); await expect(page.locator('#undo-notice-status')).toHaveText('写真をごみ箱に移しました');
  const deleted = await state(page); expect(deleted.photos.find(photo => photo.id === ids.photos[0])!.deletedAt).not.toBeNull();
  expect(deleted.links).toEqual(before.links); await expect(page.locator('#photo-count')).toContainText('0件');
  await shot(page, 'ux-r9-1-pc1440-photo-trash');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#mobile-tab-photos').click(); await shot(page, 'ux-r9-1-mobile390-photo-trash');
  await page.setViewportSize({ width: 320, height: 740 }); await shot(page, 'ux-r9-1-mobile320-photo-trash');
  await page.locator('#undo-notice-action').click(); await expect(page.locator('#undo-notice-status')).toHaveText('元に戻しました');
  const restored = await state(page); expect(restored.photos).toEqual(before.photos); expect(restored.links).toEqual(before.links); expect(restored.visits).toEqual(before.visits);
  expect(restored.history.at(-1)!.id).toBe(deleted.history.at(-1)!.id); expect(restored.history.at(-1)!.undoneAt).not.toBeNull();
  await expect(page.locator('#photo-count')).toContainText('1件'); await expect(page.locator('.map-photo-thumb')).toHaveCount(1);
});

test('R9.1 album trash Undo retains all photos and links; dismissing the notice retains management Undo', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); const ids = await seedUi(page), before = await state(page);
  await albumTrash(page, ids.albums[0]!); await expect(page.locator('#undo-notice-status')).toHaveText('アルバムをごみ箱に移しました');
  const deleted = await state(page); expect(deleted.links).toEqual(before.links); expect(deleted.photos).toEqual(before.photos);
  await shot(page, 'ux-r9-1-mobile320-album-trash'); await page.locator('#undo-notice-action').click();
  await expect(page.locator('#undo-notice-status')).toHaveText('元に戻しました');
  expect((await state(page)).visits).toEqual(before.visits); expect((await state(page)).links).toEqual(before.links);
  await expect(page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`)).toContainText('写真12枚');
  await albumTrash(page, ids.albums[0]!); await expect(page.locator('#undo-notice-action')).toBeVisible();
  const again = await state(page); await page.locator('#undo-notice-close').click(); expect(await state(page)).toEqual(again);
  await page.locator('#header-manage').click(); await expect(page.locator('#undo-button')).toBeEnabled(); await page.locator('#undo-button').click();
  await expect.poll(async () => (await state(page)).visits.find(album => album.id === ids.albums[0])!.deletedAt).toBeNull();
  const restored = await state(page); expect(restored.photos).toEqual(before.photos); expect(restored.links).toEqual(before.links);
});

test('R9.1 failed receipts never notify and a real other tab write cannot be undone by an old trash notice', async ({ page }) => {
  const ids = await seedUi(page), before = await state(page);
  const failed = await page.evaluate(async photoId => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const db = await LibraryDb.open(); const add = IDBObjectStore.prototype.add;
    let receipt: string | undefined;
    try {
      IDBObjectStore.prototype.add = function (...args) { if (this.name === 'recovery') throw new DOMException('synthetic history failure', 'QuotaExceededError'); return add.apply(this, args); };
      receipt = await db.moveToTrash('photo', photoId);
    } catch { /* Abort must reject before returning a committed receipt. */ }
    finally { IDBObjectStore.prototype.add = add; db.close(); }
    return receipt ?? null;
  }, ids.photos[0]!);
  expect(failed).toBeNull(); expect(await state(page)).toEqual(before);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.moveToTrash;
    Object.assign(window, { __r91Trash: original });
    LibraryDb.prototype.moveToTrash = async function (...args) { await original.apply(this, args); throw new Error('synthetic lost receipt'); };
  });
  await photoTrash(page, ids.photos[0]!); await expect(page.locator('#recovery-status')).toContainText('synthetic lost receipt'); await expect(page.locator('#undo-notice')).toBeHidden();
  expect((await state(page)).photos.find(photo => photo.id === ids.photos[0])!.deletedAt).not.toBeNull();
  await page.locator('#undo-button').click(); await expect.poll(async () => (await state(page)).photos.find(photo => photo.id === ids.photos[0])!.deletedAt).toBeNull();
  await page.locator('#management-close').click();
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    LibraryDb.prototype.moveToTrash = (window as unknown as { __r91Trash: typeof LibraryDb.prototype.moveToTrash }).__r91Trash;
  });
  await photoTrash(page, ids.photos[0]!); await expect(page.locator('#undo-notice-action')).toBeVisible(); const saved = await state(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const undo = LibraryDb.prototype.undoLatest;
    LibraryDb.prototype.undoLatest = async function (expected) {
      await new Promise<void>(resolve => { Object.assign(window, { __releaseR91Undo: resolve }); }); return undo.call(this, expected);
    };
  });
  await page.locator('#undo-notice-action').click(); await page.waitForFunction(() => '__releaseR91Undo' in window);
  const other = await page.context().newPage(), origin = new URL(page.url()).origin;
  await other.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort()); await other.goto('/');
  await other.evaluate(async albumId => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const album = (await db.listVisits()).find(item => item.id === albumId)!;
    await db.updateVisit({ ...album, label: '別タブの変更', updatedAt: new Date().toISOString() }); db.close();
  }, ids.albums[1]!);
  const changed = await state(page); await page.evaluate(() => (window as unknown as { __releaseR91Undo(): void }).__releaseR91Undo());
  await expect(page.locator('#undo-notice-status')).toContainText('元に戻せません'); await expect(page.locator('#undo-notice-action')).toBeHidden();
  expect(await state(page)).toEqual(changed); expect(changed.links).toEqual(saved.links); expect(changed.history.at(-1)!.undoneAt).toBeNull(); await other.close();
});
