import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test('album overview, photo viewing and editor keep the compact responsive design', async ({ page }) => {
  const ids = await seedUi(page); const folder = 'specs/ui-package/d2'; mkdirSync(folder, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(width < 700 ? '#mobile-tab-visits' : '#left-tab-visits').click();
    await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
    await expect(page.locator('#visit-summary img')).toHaveCount(3);
    await page.waitForTimeout(220); await page.screenshot({ path: `${folder}/overview-${width}.png` });
    await page.getByRole('button', { name: '写真を見る', exact: true }).click();
    await expect(page.locator('#visit-all-photo-list button').first()).toBeVisible();
    await page.locator('#visit-all-back').click();
    await page.getByRole('button', { name: '編集', exact: true }).click();
    await expect(page.locator('#visit-editor-preview img')).toHaveCount(3);
    await expect(page.locator('#visit-start, #visit-latitude')).toHaveCount(0);
    await page.screenshot({ path: `${folder}/editor-${width}.png` });
    await page.locator('#visit-label').fill('保存しないアルバム名');
    page.once('dialog', dialog => dialog.accept()); await page.locator('#visit-edit-back').click();
    await expect(page.locator('#visit-summary h3')).toHaveText('港と街の散歩');
  }
});

test('album editor still opens direct photo selection and commits only intended changes', async ({ page }) => {
  const ids = await seedUi(page);
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await page.locator('.vpe-tile input').first().click(); await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('しました');
  await page.locator('#vpe-close').click();
  await expect(page.locator('#visit-summary h3')).toHaveText('港と街の散歩');
});
