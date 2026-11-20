import { test, expect, type Page } from '@playwright/test';
import { seedUi } from './helpers/ui-package';
import { shot } from './helpers/ia-flows';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function createAlbum(page: Page, name: string) {
  await page.locator('#left-tab-visits').click(); await page.locator('#visit-create-from-list').click();
  await page.locator('#visit-label').fill(name); await expect(page.locator('#visit-save')).toHaveText('作成');
  await page.locator('#visit-save').click(); await expect(page.locator('#visit-summary h3')).toHaveText(name);
  return page.evaluate(async name => { const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const album = (await db.listVisits()).find(album => album.label === name)!; db.close(); return album; }, name);
}
async function snapshot(page: Page) {
  return page.evaluate(async () => { const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const snapshot = await db.snapshot(); db.close(); return snapshot; });
}
const selectPhoto = (page: Page, id: string) => page.locator(`#vpe-list [data-tile-id="${id}"] input[type=checkbox]`);

test('IA-3 cancel before creation writes nothing; cancel photo selection preserves the created empty album', async ({ page }) => {
  const ids = await seedUi(page); const before = await snapshot(page);
  await page.locator('#left-tab-visits').click(); await page.locator('#visit-create-from-list').click(); await page.locator('#visit-label').fill('作成前キャンセル');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#visit-edit-back').click();
  expect((await snapshot(page)).visits).toEqual(before.visits);
  await page.locator('#visit-create-from-list').click(); await page.locator('#visit-label').fill('合成：海辺の写真'); await shot(page, 'ia3-pc1440-album-create');
  await expect(page.locator('#visit-photo-edit-open')).toBeHidden();
  await page.locator('#visit-save').click(); await expect(page.locator('#visit-summary h3')).toHaveText('合成：海辺の写真');
  const album = (await snapshot(page)).visits.find(album => album.label === '合成：海辺の写真')!;
  await page.getByRole('button', { name: '写真を選択', exact: true }).click();
  await expect(page.locator('#vpe-status')).toContainText('アルバムは作成済み'); await expect(page.locator('#vpe-save')).toBeDisabled();
  await selectPhoto(page, ids.photos[0]!).check(); await page.locator('#vpe-cancel').click(); await page.locator('#vpe-leave-discard').click();
  await expect(page.locator('#visit-summary h3')).toHaveText(album.label);
  const after = await snapshot(page); expect(after.visits.some(item => item.id === album.id)).toBe(true); expect(after.links).toEqual(before.links); expect(after.photos).toEqual(before.photos);
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#mobile-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${album.id}"]`).click();
  await expect(page.locator('#mobile-tab-visits')).toHaveAttribute('aria-current', 'page'); await shot(page, 'ia3-mobile390-created-overview');
});

test('IA-3 direct photo selection uses batch save Undo and retains its album after a failed save', async ({ page }) => {
  const ids = await seedUi(page); const before = await snapshot(page); const album = await createAlbum(page, '合成：追加とUndo');
  await page.getByRole('button', { name: '写真を選択', exact: true }).click();
  await selectPhoto(page, ids.photos[0]!).check(); await selectPhoto(page, ids.photos[1]!).check(); await shot(page, 'ia3-pc1440-photo-selection');
  await page.locator('#vpe-save').click(); await expect(page.locator('#vpe-undo')).toBeVisible();
  const saved = await snapshot(page);
  expect(saved.links.filter(link => link.albumId === album.id).map(link => link.photoId).sort()).toEqual(ids.photos.slice(0, 2).sort());
  for (const link of before.links) expect(saved.links).toContainEqual(link);
  await page.locator('#vpe-undo').click(); await expect.poll(async () => (await snapshot(page)).links.length).toBe(before.links.length);
  expect((await snapshot(page)).visits.some(item => item.id === album.id)).toBe(true);
  await page.evaluate(async () => { const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); LibraryDb.prototype.saveAlbumMembershipBatch = async () => { throw new Error('合成保存失敗'); }; });
  await selectPhoto(page, ids.photos[0]!).check(); await page.locator('#vpe-save').click(); await expect(page.locator('#vpe-status')).toContainText('合成保存失敗');
  await expect(selectPhoto(page, ids.photos[0]!)).toBeChecked();
  const failed = await snapshot(page); expect(failed.links).toEqual(before.links); expect(failed.visits.some(item => item.id === album.id)).toBe(true); expect(failed.photos).toEqual(before.photos);
  await page.locator('#vpe-cancel').click(); await page.locator('#vpe-leave-discard').click();
});

test('IA-3 creation pins its Trip protects unsaved input and confirms a lost response without duplicate creation', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true });
  await page.locator('#left-tab-visits').click(); await page.locator('#visit-create-from-list').click(); await page.locator('#visit-label').fill('合成：保存を確認');
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#trip-select').selectOption(ids.otherTrip!);
  await expect(page.locator('#trip-select')).toHaveValue(ids.trip); await expect(page.locator('#visit-label')).toHaveValue('合成：保存を確認');
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.createVisit, list = LibraryDb.prototype.listVisits;
    LibraryDb.prototype.createVisit = async function (...args) {
      await new Promise<void>(resolve => { Object.assign(window, { __releaseAlbum: resolve }); });
      await original.apply(this, args); Object.assign(window, { __albumWritten: true, __albumWrites: Number((window as unknown as { __albumWrites?: number }).__albumWrites ?? 0) + 1 }); throw new Error('合成応答喪失');
    };
    LibraryDb.prototype.listVisits = async function () { if ((window as unknown as { __albumWritten?: boolean }).__albumWritten && !(window as unknown as { __allowAlbumReads?: boolean }).__allowAlbumReads) throw new Error('合成照会失敗'); return list.call(this); };
  });
  await page.locator('#visit-save').click(); await page.locator('#visit-form').dispatchEvent('submit');
  await page.locator('#trip-select').selectOption(ids.otherTrip!); await expect(page.locator('#trip-select')).toHaveValue(ids.trip);
  await page.locator('#right-close').click(); await expect(page.locator('#visit-label')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __releaseAlbum(): void }).__releaseAlbum());
  await expect(page.locator('#visit-save')).toHaveText('保存状態を確認'); await expect(page.locator('#visit-edit-back')).toBeDisabled();
  await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click(); await expect(page.locator('#visit-label')).toHaveValue('合成：保存を確認');
  await page.evaluate(() => { Object.assign(window, { __allowAlbumReads: true }); });
  await page.locator('#visit-save').click(); await expect(page.locator('#visit-summary h3')).toHaveText('合成：保存を確認');
  const created = (await snapshot(page)).visits.filter(album => album.label === '合成：保存を確認'); expect(created).toHaveLength(1); expect(created[0]!.tripId).toBe(ids.trip);
  expect(await page.evaluate(() => (window as unknown as { __albumWrites: number }).__albumWrites)).toBe(1);
  await page.setViewportSize({ width: 320, height: 740 }); await page.locator('#mobile-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${created[0]!.id}"]`).click();
  await page.getByRole('button', { name: '写真を選択', exact: true }).click(); await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible(); await shot(page, 'ia3-mobile320-photo-selection');
  expect(await page.locator('#visit-photo-editor-overlay').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(false);
  await expect(page.locator('#vpe-cancel')).toBeInViewport(); await expect(page.locator('#vpe-save')).toBeInViewport();
});
