import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test('photo search, preview and detail retain metadata and membership editing access', async ({ page }) => {
  const ids = await seedUi(page);
  await page.locator('#photo-search').fill('海辺-1.jpg');
  await expect(page.locator('#photo-count')).toContainText('1件');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('海辺-1.jpg');
  await expect(page.locator('#photo-detail img')).toHaveAttribute('alt', '海辺-1.jpg のサムネイル');
  await expect(page.locator('#photo-advanced')).toHaveCount(0);
  await expect(page.locator('.photo-albums')).toContainText('港と街の散歩');
  await expect(page.locator('.photo-summary')).toContainText('時差不明');
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await expect(page.locator('#photo-advanced')).not.toHaveAttribute('open', '');
  await page.locator('#photo-advanced > summary').click();
  await expect(page.locator('#gps-correction-latitude')).toBeVisible();
  await expect(page.locator('#time-correction-clock')).toBeVisible();
  await page.locator('#photo-album-edit-open').click();
  await expect(page.locator('#pae-search')).toBeVisible();
  await page.locator('#pae-close').click();
  await page.getByRole('button', { name: 'プレビューに戻る', exact: true }).click();
  await expect(page.locator('#photo-advanced')).toHaveCount(0);
  await page.locator('#right-close').click();
  await expect(page.locator('#photo-search')).toHaveValue('海辺-1.jpg');
  await page.locator('#photo-filter-clear').click();
  await expect(page.locator('#photo-count')).toContainText('24件');
});

test('photo gallery, preview and detail fit desktop and mobile viewports', async ({ page }) => {
  const ids = await seedUi(page); const folder = 'specs/ui-package/d3'; mkdirSync(folder, { recursive: true });
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(220); // Let the responsive auto-close finish before opening the list.
    if (width >= 700 && await page.locator('body').getAttribute('data-left-open') === 'false') await page.locator('#header-left').click();
    await page.locator(width < 700 ? '#mobile-tab-photos' : '#left-tab-photos').click();
    await page.locator('#left-panel').evaluate(element => { element.scrollTop = 0; });
    await expect(page.locator('#photo-list img').first()).toBeVisible();
    await page.waitForTimeout(220); await page.screenshot({ path: `${folder}/gallery-${width}.png` });
    await page.locator('#photo-search').fill('ランチ-24.jpg');
    await expect(page.locator('#photo-count')).toContainText('1件');
    const tile = page.locator(`#photo-list [data-photo-id="${ids.photos[23]}"]`);
    if (width === 1440) await tile.press('Enter'); else await tile.click();
    await expect(page.locator('#photo-detail h3')).toHaveText('ランチ-24.jpg');
    await expect(page.locator('.photo-summary')).toContainText('位置');
    await page.waitForTimeout(220);
    await expect(page.getByRole('button', { name: '詳細を見る', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    if (width < 700) {
      const preview = await page.locator('#right-panel').boundingBox(); const tabs = await page.locator('#mobile-tabs').boundingBox();
      expect(preview!.y + preview!.height).toBeLessThanOrEqual(tabs!.y);
    }
    await page.screenshot({ path: `${folder}/preview-${width}.png` });
    await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
    await expect(page.locator('#photo-album-edit-open')).toBeVisible();
    await page.screenshot({ path: `${folder}/detail-${width}.png` });
    await page.locator('#right-close').click();
    if (width >= 700 && await page.locator('body').getAttribute('data-left-open') === 'false') await page.locator('#header-left').click();
    await page.locator('#photo-filter-clear').click();
    await expect(page.locator('#photo-count')).toContainText('24件');
  }
});
