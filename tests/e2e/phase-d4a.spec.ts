import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedLiveUi } from './helpers/ui-live-map';

const folder = 'specs/ui-package/d4a/after';
test.beforeEach(async () => { test.setTimeout(90_000); mkdirSync(folder, { recursive: true }); });
async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${folder}/${name}.png` });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const trip = await page.locator('#trip-select').boundingBox(), buttons = await page.locator('.header-actions').boundingBox();
  expect(trip!.x + trip!.width).toBeLessThanOrEqual(buttons!.x + 1);
}
async function selectAlbum(page: Page, id: string, mobile = false) {
  await page.locator(mobile ? '#mobile-tab-visits' : '#left-tab-visits').click();
  await page.locator(`#visit-list [data-visit-id="${id}"]`).click();
  await expect(page.locator('#visit-summary img')).toHaveCount(3);
}

test('album overview and editor leave the live map visible and preserve cancel/save behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); const ids = await seedLiveUi(page);
  await page.locator('#left-tab-visits').click(); await shot(page, 'album-list-1440');
  await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await expect(page.locator('#visit-summary img')).toHaveCount(3);
  await shot(page, 'album-overview-1440');
  expect((await page.locator('#right-panel').boundingBox())!.height).toBeLessThan(760);
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await expect(page.locator('#visit-editor-preview img')).toHaveCount(3);
  await shot(page, 'album-edit-1440');
  await expect(page.locator('#visit-save')).toBeInViewport();
  await expect(page.locator('#visit-start, #visit-latitude')).toHaveCount(0);
  await page.locator('#visit-label').fill('未保存の名前');
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#visit-edit-back').click();
  await expect(page.locator('#visit-label')).toHaveValue('未保存の名前');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#visit-edit-back').click();
  await expect(page.locator('#visit-summary h3')).toHaveText('港と街の散歩');
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-label').fill('港と街の散歩・保存確認'); await page.locator('#visit-save').click();
  await expect(page.locator('#visit-summary h3')).toHaveText('港と街の散歩・保存確認');
  expect(ids.audit.blocked).toEqual([]); expect(ids.audit.failed).toEqual([]);
});

test('photo gallery preview detail and membership editing work over the live map', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); const ids = await seedLiveUi(page);
  await shot(page, 'photo-list-1440');
  await page.locator('#photo-search').fill('海辺-1.jpg');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await expect(page.locator('#photo-detail img')).toHaveAttribute('title', /原本写真ではありません/);
  await shot(page, 'photo-preview-1440');
  await expect(page.locator('#photo-advanced')).toHaveCount(0);
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await shot(page, 'photo-detail-1440');
  await expect(page.locator('#photo-detail')).not.toContainText('保存済みサムネイルを表示しています');
  await page.locator('#photo-album-edit-open').click();
  await expect(page.locator('#pae-search')).toBeVisible(); await page.locator('#pae-close').click();
  await page.locator('#photo-advanced > summary').click();
  await expect(page.locator('#gps-correction-latitude')).toBeVisible();
  await expect(page.locator('#time-correction-clock')).toBeVisible();
  await page.locator('#photo-advanced > summary').click();
  await page.locator('#right-close').click(); await page.locator('#photo-search').fill('ランチ-24.jpg');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[23]}"]`).click();
  await expect(page.locator('.photo-summary')).toContainText('GPSなし');
  await expect(page.locator('#photo-detail .hint')).toHaveCount(0);
  expect(ids.audit.blocked).toEqual([]); expect(ids.audit.failed).toEqual([]);
});

test('live map mobile navigation editor actions and narrow viewports remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const ids = await seedLiveUi(page);
  await expect(page.locator('#mobile-tab-map')).toHaveAttribute('aria-current', 'page');
  await shot(page, 'map-390');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(220);
    await noOverflow(page); await selectAlbum(page, ids.albums[0]!, true);
    await page.getByRole('button', { name: '編集', exact: true }).click();
    await expect(page.locator('#mobile-tab-visits')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#visit-save')).toBeInViewport();
    await shot(page, `album-edit-${width}`);
    await page.setViewportSize({ width, height: 540 });
    await page.locator('#visit-label').fill('入力を保持');
    await page.locator('#visit-save').scrollIntoViewIfNeeded();
    await expect(page.locator('#visit-save')).toBeInViewport();
    page.once('dialog', dialog => dialog.accept()); await page.locator('#visit-edit-back').click();
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '編集', exact: true }).click();
    await page.locator('#visit-photo-edit-open').click(); await page.locator('.vpe-tile input').first().click();
    await page.locator('#mobile-tab-map').click(); await expect(page.locator('#vpe-leave')).toBeVisible();
    await page.locator('#vpe-leave-stay').click();
    await page.locator('#vpe-close').click(); await page.locator('#vpe-leave-discard').click();
    await page.locator('#right-close').click(); await page.locator('#mobile-tab-photos').click();
    await page.locator('#photo-search').fill('海辺-1.jpg');
    await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
    await expect(page.getByRole('button', { name: '詳細を見る', exact: true })).toBeInViewport();
    await shot(page, `photo-preview-${width}`);
    await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
    await shot(page, `photo-detail-${width}`);
    await expect(page.locator('#photo-album-edit-open')).toBeInViewport();
    const panel = await page.locator('#right-panel').boundingBox(), tabs = await page.locator('#mobile-tabs').boundingBox();
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(tabs!.y);
    await page.locator('#right-close').click(); await page.locator('#photo-filter-clear').click();
  }
  await page.setViewportSize({ width: 900, height: 900 }); await page.waitForTimeout(220);
  await noOverflow(page); await page.locator('#header-left').click();
  await selectAlbum(page, ids.albums[0]!); await shot(page, 'album-overview-900');
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await expect(page.locator('#visit-save')).toBeInViewport();
  expect(ids.audit.blocked).toEqual([]); expect(ids.audit.failed).toEqual([]);
  writeFileSync(`${folder}/map-audit.json`, JSON.stringify(ids.audit, null, 2));
});
