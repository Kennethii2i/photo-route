import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test('header and navigation remain compact with accessible actions at desktop and mobile widths', async ({ page }) => {
  await seedUi(page); const folder = 'specs/ui-package/d1'; mkdirSync(folder, { recursive: true });
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.evaluate(() => ({ trip: document.querySelector('#trip-select')!.getBoundingClientRect().right,
      actions: document.querySelector('.header-actions')!.getBoundingClientRect().left, overflow: document.documentElement.scrollWidth > innerWidth }));
    expect(bounds.trip).toBeLessThanOrEqual(bounds.actions + 1); expect(bounds.overflow).toBe(false);
    await page.locator('#header-add').click(); await expect(page.locator('#import-panel')).toBeVisible(); await page.locator('#management-close').click();
    if (width < 700) {
      await page.locator('#mobile-tab-photos').click(); await expect(page.locator('#mobile-tab-photos')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#photo-list img').first()).toBeVisible();
    }
    await page.waitForTimeout(220); await page.screenshot({ path: `${folder}/header-${width}.png` });
  }
});

test('mobile navigation still protects pending album photo selection', async ({ page }) => {
  const ids = await seedUi(page);
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#mobile-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '編集', exact: true }).click(); await page.locator('#visit-photo-edit-open').click();
  await page.locator('.vpe-tile input').first().click();
  await page.locator('#mobile-tab-photos').click(); await expect(page.locator('#vpe-leave')).toBeVisible();
  await page.locator('#vpe-leave-stay').click(); await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
});
