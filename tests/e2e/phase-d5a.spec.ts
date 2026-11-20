import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { seedLiveUi } from './helpers/ui-live-map';

const folder = 'specs/ui-package/d5a/after';
const albumName = '海辺で見つけたお気に入りの風景と週末の散歩記録';
const photoName = '海辺の朝_長いファイル名の写真_2026-01-02.jpg';
test.beforeEach(() => { test.setTimeout(90_000); mkdirSync(folder, { recursive: true }); });
async function shot(page: Page, name: string) {
  await page.waitForTimeout(200); await page.screenshot({ path: `${folder}/${name}.png` });
}
async function readData(page: Page, photoId: string) {
  return page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    try { return { photo: (await db.listPhotos()).find(photo => photo.id === id), links: await db.listPhotoAlbumLinks() }; } finally { db.close(); }
  }, photoId);
}
async function checkBounds(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const panel = await page.locator('#right-panel').boundingBox(), tabs = await page.locator('#mobile-tabs').boundingBox();
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(tabs!.y + 1);
  expect(await page.locator('#right-panel').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test('mobile sparse album fits its content and keeps editing saving and draft protection accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const ids = await seedLiveUi(page, { mobileEditing: true });
  const before = await readData(page, ids.photos[0]!);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('#mobile-tab-visits').click(); await page.locator(`[data-visit-id="${ids.albums[0]}"]`).click();
    await expect(page.locator('#visit-summary h3')).toHaveText(albumName);
    await shot(page, `album-overview-${width}`);
    await page.getByRole('button', { name: '編集', exact: true }).click();
    await expect(page.locator('#mobile-tab-visits')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#visit-editor-preview img')).toHaveCount(1);
    await expect(page.locator('#visit-save')).toBeInViewport({ ratio: 1 });
    await checkBounds(page);
    expect((await page.locator('#right-panel').boundingBox())!.height).toBeLessThan(620);
    await shot(page, `album-edit-${width}`);
    await page.locator('#visit-photo-edit-open').click(); await page.locator('.vpe-tile input').first().click();
    await page.locator('#vpe-close').click(); await expect(page.locator('#vpe-leave')).toBeVisible();
    await page.locator('#vpe-leave-stay').click(); await page.locator('#vpe-close').click(); await page.locator('#vpe-leave-discard').click();
    await page.getByRole('button', { name: '編集', exact: true }).click();
    await page.locator('#visit-label').fill(`${albumName}・未保存`);
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#visit-edit-back').click();
    await expect(page.locator('#visit-label')).toHaveValue(`${albumName}・未保存`);
    await page.setViewportSize({ width, height: 440 });
    await page.locator('#visit-label').focus(); await page.locator('#visit-label').scrollIntoViewIfNeeded();
    const input = await page.locator('#visit-label').boundingBox(), actions = await page.locator('#visit-form .form-actions').boundingBox();
    expect(input!.y + input!.height).toBeLessThanOrEqual(actions!.y + 1);
    await expect(page.locator('#visit-save')).toBeInViewport({ ratio: 1 });
    await shot(page, `album-edit-short-${width}`);
    page.once('dialog', dialog => dialog.accept()); await page.locator('#visit-edit-back').click();
    await expect(page.locator('#visit-summary h3')).toHaveText(albumName);
    await page.setViewportSize({ width, height: 844 }); await page.locator('#right-close').click();
  }
  await page.locator(`[data-visit-id="${ids.albums[0]}"]`).click(); await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-label').fill(`${albumName}・保存確認`); await page.locator('#visit-save').click();
  await expect(page.locator('#visit-summary h3')).toHaveText(`${albumName}・保存確認`);
  expect(await readData(page, ids.photos[0]!)).toEqual(before);
  expect(ids.audit.blocked).toEqual([]); expect(ids.audit.failed).toEqual([]);
});

test('mobile photo detail keeps corrections and membership access usable at reduced viewport height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const ids = await seedLiveUi(page, { mobileEditing: true });
  const before = await readData(page, ids.photos[0]!);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.locator('#mobile-tab-photos').click();
    await page.locator('#photo-search').fill('海辺の朝_'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
    await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
    await expect(page.locator('#photo-detail h3')).toHaveText(photoName);
    await expect(page.locator('#photo-advanced')).not.toHaveAttribute('open', '');
    await expect(page.locator('#mobile-tab-photos')).toHaveAttribute('aria-current', 'page');
    await checkBounds(page); await shot(page, `photo-detail-${width}`);
    await page.locator('#photo-album-edit-open').click(); await page.locator('.pae-album input').first().click();
    await page.locator('#pae-close').click(); await expect(page.locator('#pae-leave')).toBeVisible();
    await page.locator('#pae-leave-stay').click(); await page.locator('#pae-close').click(); await page.locator('#pae-leave-discard').click();
    await page.locator('#photo-advanced > summary').click();
    await page.setViewportSize({ width, height: 440 });
    await page.locator('#gps-correction-longitude').focus(); await page.locator('#gps-correction-longitude').scrollIntoViewIfNeeded();
    const input = await page.locator('#gps-correction-longitude').boundingBox();
    const actions = await page.locator('form[aria-label="GPS補正"] .photo-correction-actions').boundingBox();
    expect(input!.y + input!.height).toBeLessThanOrEqual(actions!.y + 1);
    await expect(page.getByRole('button', { name: 'GPS補正を保存', exact: true })).toBeInViewport({ ratio: 1 });
    await shot(page, `photo-edit-short-${width}`);
    await page.locator('#time-correction-offset').focus(); await page.locator('#time-correction-offset').scrollIntoViewIfNeeded();
    const timeInput = await page.locator('#time-correction-offset').boundingBox();
    const timeActions = await page.locator('form[aria-label="撮影日時補正"] .photo-correction-actions').boundingBox();
    expect(timeInput!.y + timeInput!.height).toBeLessThanOrEqual(timeActions!.y + 1);
    await expect(page.getByRole('button', { name: '撮影日時補正を保存', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.locator('.photo-correction-actions').evaluateAll(items => items.map(item => getComputedStyle(item).position))).toEqual(['static', 'sticky']);
    await shot(page, `photo-time-short-${width}`);
    await page.setViewportSize({ width, height: 844 }); await page.locator('#right-close').click();
  }
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click(); await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await page.locator('#photo-advanced > summary').click();
  await page.locator('#gps-correction-latitude').fill('32.731'); await page.locator('#gps-correction-longitude').fill('129.871');
  await page.getByRole('button', { name: 'GPS補正を保存', exact: true }).click();
  await expect(page.locator('.photo-summary')).toContainText('手動補正');
  await page.locator('#time-correction-clock').fill('2026:01:02 09:30:00');
  await page.getByRole('button', { name: '撮影日時補正を保存', exact: true }).click();
  await expect(page.locator('.photo-summary')).toContainText('09:30');
  const after = await readData(page, ids.photos[0]!);
  expect(after.links).toEqual(before.links); expect(after.photo!.sourceGps).toEqual(before.photo!.sourceGps);
  expect(after.photo!.sourceTime).toEqual(before.photo!.sourceTime); expect(after.photo!.thumbnailId).toBe(before.photo!.thumbnailId);
  expect(after.photo!.timeCorrection!.correctedUtc).toBeNull();
  expect(after.photo!.gpsCorrection!.value).toEqual({ latitude: 32.731, longitude: 129.871 });
  expect(ids.audit.blocked).toEqual([]); expect(ids.audit.failed).toEqual([]);
});
