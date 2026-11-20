import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { localUi, createTripUi, photoListUi } from './helpers/ux-rc-flows';

test.use({ actionTimeout: 7000 });
async function state(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const snapshot = await db.snapshot(), history = await db.listRecovery(); db.close();
    const thumbnails = await Promise.all(snapshot.thumbnails.map(async ({ blob, ...meta }) => ({ ...meta,
      hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',') })));
    return { ...snapshot, thumbnails, history };
  });
}
async function albums(page: Page) {
  if (page.viewportSize()!.width <= 700) {
    if (await page.locator('body').getAttribute('data-right-open') === 'true') await page.locator('#right-close').click();
    await page.locator('#mobile-tab-visits').click();
  }
  else {
    if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
    await page.locator('#left-tab-visits').click();
  }
}
async function shot(page: Page, name: string) {
  mkdirSync('specs/ux-rc/screenshots', { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  if (await page.locator('#undo-notice').isVisible() && page.viewportSize()!.width === 320) {
    expect((await page.locator('#undo-notice').boundingBox())!.height).toBeLessThanOrEqual(64);
  }
  if (await page.locator('#undo-notice').isVisible() && await page.locator('#import-task').isVisible()) {
    const notice = (await page.locator('#undo-notice').boundingBox())!, task = (await page.locator('#import-task').boundingBox())!;
    expect(notice.x < task.x + task.width && notice.x + notice.width > task.x && notice.y < task.y + task.height && notice.y + notice.height > task.y).toBe(false);
  }
  await page.screenshot({ path: `specs/ux-rc/screenshots/${name}.png`, animations: 'disabled' });
}

for (const width of [1440, 390]) test(`UX-RC ${width === 1440 ? 'PC' : 'mobile'} ordinary journey keeps records across import both editors trash Undo and map dismissal`, async ({ page }) => {
  test.setTimeout(45_000); await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
  const external = await localUi(page); await page.goto('/'); const trip = await createTripUi(page, '合成：海辺の試用');
  await page.locator('#header-add').click(); await page.locator('#photo-files').setInputFiles([
    { name: 'sea.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') },
    { name: 'town.png', mimeType: 'image/png', buffer: readFileSync('fixtures/generated/png_no_metadata.png') },
  ]);
  await page.locator('#import-button').click(); await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'done');
  await page.locator('#import-done').click(); await photoListUi(page); await expect(page.locator('#photo-count')).toContainText('2件');
  const imported = await state(page), photo = imported.photos.find(item => item.originalFilename === 'sea.jpg')!;
  expect(imported.photos.every(item => item.tripId === trip && item.visitId === null)).toBe(true);
  await page.locator('#photo-search').fill('sea'); await page.locator(`#photo-list [data-photo-id="${photo.id}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('sea.jpg');
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await page.getByRole('button', { name: 'プレビューに戻る', exact: true }).click();
  await page.locator('#photo-detail').getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();
  if (width === 1440) {
    await page.locator('#drawer-toggle').click(); await page.locator('#drawer-toggle').click();
    await expect(page.locator('#photo-search')).toHaveValue('sea'); await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();
  } else await expect(page.locator('#mobile-tab-map')).toHaveAttribute('aria-current', 'page');
  await albums(page);
  for (const name of ['海辺の散歩', 'お気に入り']) {
    await albums(page);
    await page.locator('#visit-create-from-list').click(); await page.locator('#visit-label').fill(name); await page.locator('#visit-save').click();
    await expect(page.locator('#visit-summary h3')).toHaveText(name);
    await expect(page.locator('#right-panel .panel-top strong')).toHaveText('アルバム');
  }
  const created = await state(page), a = created.visits.find(item => item.label === '海辺の散歩')!, b = created.visits.find(item => item.label === 'お気に入り')!;
  await albums(page);
  await page.locator(`#visit-list [data-visit-id="${a.id}"]`).click();
  await page.getByRole('button', { name: '写真を選択', exact: true }).click();
  await page.locator(`#vpe-list [data-tile-id="${photo.id}"] input`).check(); await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('1枚追加'); await page.locator('#vpe-close').click();
  await photoListUi(page); await page.locator(`#photo-list [data-photo-id="${photo.id}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await page.locator('#photo-album-edit-open').click();
  await page.locator(`#pae-list [data-album-id="${b.id}"] input`).check(); await page.locator('#pae-save').click();
  await expect(page.locator('#pae-status')).toContainText('1件追加'); await page.locator('#pae-close').click();
  const memberships = await state(page); expect(memberships.links.filter(link => link.photoId === photo.id).map(link => link.albumId).sort()).toEqual([a.id, b.id].sort());
  await page.locator('#photo-advanced > summary').click(); await page.locator('.photo-trash').click(); await page.locator('#trash-commit').click();
  await expect(page.locator('#undo-notice-action')).toBeVisible(); await expect(page.locator('#undo-notice-status')).toHaveText('写真をごみ箱に移しました');
  await shot(page, `ux-rc-${width}-photo-undo`);
  if (width === 390) { await page.setViewportSize({ width: 320, height: 740 }); await shot(page, 'ux-rc-320-photo-undo'); await page.setViewportSize({ width: 390, height: 844 }); }
  await expect(page.locator('#map-status')).not.toContainText('検索に一致する写真はありません');
  await page.locator('#undo-notice-action').click(); await expect(page.locator('#undo-notice-status')).toHaveText('元に戻しました');
  expect((await state(page)).photos).toEqual(imported.photos);
  await albums(page); await page.locator(`#visit-list [data-visit-id="${a.id}"]`).click();
  await page.getByRole('button', { name: '編集', exact: true }).click(); await page.locator('#visit-delete').click(); await page.locator('#trash-commit').click();
  await expect(page.locator('#undo-notice-action')).toBeVisible(); expect((await state(page)).links).toEqual(memberships.links);
  await page.locator('#undo-notice-action').click(); await expect(page.locator('#undo-notice-status')).toHaveText('元に戻しました');
  const restored = await state(page); expect(restored.photos).toEqual(imported.photos); expect(restored.thumbnails).toEqual(imported.thumbnails);
  expect(restored.visits).toEqual(created.visits); expect(restored.links).toEqual(memberships.links);
  await page.locator('#undo-notice-close').click(); expect(await state(page)).toEqual(restored); await expect(page.locator('#photo-search')).toHaveValue('sea');
  await page.locator(`#visit-list [data-visit-id="${a.id}"]`).click(); await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await photoListUi(page); await page.locator(`#photo-list [data-photo-id="${photo.id}"]`).click();
  await page.locator('#photo-detail').getByRole('button', { name: '地図で見る', exact: true }).click();
  await page.mouse.click(width === 1440 ? 700 : 20, width === 1440 ? 180 : 250);
  await expect(page.locator('#right-panel')).toBeHidden(); await expect(page.locator('#visit-focus-banner')).toBeVisible(); await expect(page.locator('#photo-search')).toHaveValue('sea');
  if (width === 1440) { await page.mouse.click(700, 180); await expect(page.locator('#left-panel')).toBeHidden(); }
  await shot(page, `ux-rc-${width}-map`);
  await albums(page); await page.locator(`#visit-list [data-visit-id="${a.id}"]`).click(); await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-label').fill('未保存の名前'); await page.locator('#right-close').click(); await expect(page.locator('#photo-correction-leave')).toBeVisible();
  await page.locator('#correction-leave-stay').click(); await expect(page.locator('#visit-label')).toHaveValue('未保存の名前');
  await page.locator('#right-close').click(); await page.locator('#correction-leave-discard').click(); expect(await state(page)).toEqual(restored);
  if (width === 390) {
    await albums(page); await page.locator(`#visit-list [data-visit-id="${a.id}"]`).click(); await page.getByRole('button', { name: '写真を選択', exact: true }).click();
    await page.locator(`#vpe-list [data-tile-id="${photo.id}"] input`).uncheck();
    await page.evaluate(async () => {
      const { LibraryDb, AlbumMembershipConflict } = await import('../../src/infrastructure/storage.ts');
      LibraryDb.prototype.saveAlbumMembershipBatch = async () => { throw new AlbumMembershipConflict(null, 'membership-changed'); };
    });
    await page.locator('#vpe-save').click(); await expect(page.locator('#vpe-conflict')).toBeVisible(); await page.locator('#vpe-conflict-close').click();
    await expect(page.locator('#vpe-save')).toBeDisabled(); await expect(page.locator('#vpe-state-review')).toBeVisible();
    await page.locator('#vpe-state-review').click(); await expect(page.locator('#vpe-restart')).toBeVisible(); await page.locator('#vpe-restart').click();
    await expect(page.locator('#vpe-status')).toContainText('最新状態から');
    await expect(page.locator(`#vpe-list [data-tile-id="${photo.id}"] input`)).toBeChecked();
    await page.locator(`#vpe-list [data-tile-id="${photo.id}"] input`).uncheck();
    await page.evaluate(async () => {
      const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); LibraryDb.prototype.saveAlbumMembershipBatch = async () => { throw new Error('synthetic response loss'); };
      LibraryDb.prototype.albumMembershipOperationStatus = async () => 'unknown';
    });
    await page.locator('#vpe-save').click(); await expect(page.locator('#vpe-conflict')).toBeVisible(); await page.locator('#vpe-conflict-close').click();
    await page.locator('#vpe-close').click(); await expect(page.locator('#vpe-conflict')).toBeVisible(); await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
    await expect(page.locator('#undo-notice')).toBeHidden(); expect(await state(page)).toEqual(restored);
    await shot(page, 'ux-rc-390-save-state-unknown');
  }
  expect(external).toEqual([]);
});
