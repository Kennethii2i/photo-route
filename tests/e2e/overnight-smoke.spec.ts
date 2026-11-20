import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedLiveUi } from './helpers/ui-live-map';

const folder = 'specs/overnight-2026-11-20/final';
async function shot(page: Page, name: string) {
  await page.waitForTimeout(250); await page.screenshot({ path: `${folder}/${name}.png` });
}
test('final live-map screens search and both editing entrances remain usable', async ({ page }) => {
  test.setTimeout(90_000); mkdirSync(folder, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 }); const ids = await seedLiveUi(page, { searchScenario: true });
  await shot(page, 'desktop-map-photos-1440');
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await expect(page.locator('#visit-summary img')).toHaveCount(3); await shot(page, 'desktop-album-overview-1440');
  await page.getByRole('button', { name: '編集', exact: true }).click(); await expect(page.locator('#visit-photo-edit-open')).toBeVisible();
  await page.locator('#visit-edit-back').click(); await page.locator('#right-close').click(); await page.locator('#left-tab-photos').click();
  await page.locator('#photo-search').fill('海辺-1.jpg'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await shot(page, 'desktop-photo-detail-1440');
  await page.locator('#photo-album-edit-open').click(); await expect(page.locator('#photo-album-editor')).toHaveAttribute('open', ''); await page.locator('#pae-close').click();
  await page.locator('#right-close').click(); await page.locator('#photo-filter-clear').click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#mobile-tab-photos').click();
  await page.locator('#left-panel').evaluate(element => { element.scrollTop = 0; });
  await expect(page.locator('#mobile-tab-photos')).toHaveAttribute('aria-current', 'page'); await shot(page, 'mobile-photos-390');
  await page.locator('#mobile-tab-visits').click(); await expect(page.locator('#visit-list button')).toHaveCount(4); await shot(page, 'mobile-albums-390');
  await page.locator('#album-search').fill('港と街'); await expect(page.locator('#visit-list button')).toHaveCount(2);
  await page.locator('#album-search').fill(''); await page.locator('#mobile-tab-photos').click();
  await page.locator('#photo-filter-more > summary').click(); await page.locator('#photo-visit-filter').selectOption(`album:${ids.albums[0]}`);
  await expect(page.locator('#photo-count')).toContainText('12件'); await shot(page, 'mobile-filters-390');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); await shot(page, 'mobile-filters-320');
  await page.locator('#photo-filter-clear').click(); await expect(page.locator('#photo-count')).toContainText('24件');
  await page.locator('#photo-filter-more > summary').click(); await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-tab-map').click();
  await page.locator('#map-tools > summary').click(); await page.locator('#map-fit').click(); await page.locator('#map-tools > summary').click();
  await expect(page.locator('.map-photo-thumb img').first()).toBeVisible();
  await expect(page.locator('#mobile-tab-map')).toHaveAttribute('aria-current', 'page'); await shot(page, 'mobile-map-390');
  expect(ids.audit.successfulTiles).toBeGreaterThan(0); expect(ids.audit.blocked).toEqual([]); expect(ids.audit.failed).toEqual([]);
});
