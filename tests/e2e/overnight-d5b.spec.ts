import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';
import { seedLiveUi } from './helpers/ui-live-map';

const folder = 'specs/overnight-2026-11-20/d5b';
test.beforeEach(() => { mkdirSync(folder, { recursive: true }); });

test('320px immediate search Enter keeps focus and result keyboard selection', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 440 }); await seedUi(page);
  await page.locator('#mobile-tab-photos').click();
  for (let index = 0; index < 10; index++) {
    await page.locator('#photo-search').fill(index % 2 ? '海辺-1.jpg' : 'ランチ-24.jpg');
    await page.keyboard.press('Enter');
    await expect(page.locator('#photo-search')).toBeFocused();
    await expect(page.locator('#photo-count')).toContainText('1件');
    for (let tab = 0; tab < 3; tab++) await page.keyboard.press('Tab');
    await expect(page.locator('#photo-list button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-right-open', 'true');
    await expect(page.locator('#photo-detail h3')).toHaveText(index % 2 ? '海辺-1.jpg' : 'ランチ-24.jpg');
    await page.locator('#right-close').click(); await page.locator('#photo-filter-clear').click();
  }
});

test('short mobile inputs retain reachable album correction and membership actions', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 440 }); await page.locator('#mobile-tab-visits').click();
    await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click(); await page.getByRole('button', { name: '編集', exact: true }).click();
    await page.locator('#visit-label').fill('入力を保持する名前'); await page.locator('#visit-label').focus();
    await expect(page.locator('#visit-save')).toBeInViewport({ ratio: 1 });
    page.once('dialog', dialog => dialog.accept()); await page.locator('#visit-edit-back').click();
    await page.locator('#right-close').click(); await page.locator('#mobile-tab-photos').click();
    await page.locator('#photo-search').fill('海辺の朝_'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
    await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await page.locator('#photo-advanced > summary').click();
    for (const [field, button] of [['#gps-correction-longitude', 'GPS補正を保存'], ['#time-correction-offset', '撮影日時補正を保存']] as const) {
      await page.locator(field!).focus(); await page.locator(field!).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: button, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await page.locator('#photo-album-edit-open').click(); await page.locator('#pae-search').fill('海');
    await expect(page.locator('#pae-search')).toBeFocused();
    await expect(page.locator('#pae-cancel')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#pae-save')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.pae-album').first()).toBeInViewport();
    await page.screenshot({ path: `${folder}/membership-input-${width}.png` });
    await page.locator('#pae-close').click(); await page.locator('#right-close').click(); await page.locator('#photo-filter-clear').click();
  }
});

test('mobile standard attribution can collapse and expose all required links', async ({ page }) => {
  test.setTimeout(60_000); await page.setViewportSize({ width: 320, height: 700 }); const ids = await seedLiveUi(page);
  const attribution = page.locator('.maplibregl-ctrl-attrib');
  await expect(attribution).toHaveClass(/maplibregl-compact/);
  const toggle = attribution.locator('summary');
  await expect(attribution.locator('a[href="https://openfreemap.org"]')).toBeVisible();
  await expect(attribution).toContainText('OpenStreetMap'); await expect(attribution).toContainText('OpenMapTiles');
  expect(await attribution.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await toggle.click(); await expect(attribution.locator('.maplibregl-ctrl-attrib-inner')).toBeHidden();
  const bounds = await toggle.boundingBox(); expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${folder}/attribution-compact-320.png` });
  await toggle.press('Enter'); await expect(attribution.locator('.maplibregl-ctrl-attrib-inner')).toBeVisible();
  expect(ids.audit.failed).toEqual([]); expect(ids.audit.blocked).toEqual([]);
});
