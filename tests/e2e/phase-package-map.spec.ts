import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test('official Positron loads by default with attribution and map-only GET traffic', async ({ page }) => {
  test.setTimeout(90_000);
  const ids = await seedUi(page);
  await page.unroute('**/*');
  const requests: { host: string; path: string; method: string }[] = [], blocked: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === '5184') return route.continue();
    if (url.hostname === 'tiles.openfreemap.org') {
      requests.push({ host: url.hostname, path: url.pathname, method: route.request().method() });
      return route.continue();
    }
    blocked.push(url.hostname); return route.abort();
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap', { timeout: 35_000 });
  await expect(page.locator('#basemap-toggle')).toHaveCount(0);
  await expect.poll(() => requests.some(item => item.path.includes('/planet/') && item.path.endsWith('.pbf')), { timeout: 35_000 }).toBe(true);
  const folder = 'specs/ui-package/map'; mkdirSync(folder, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.locator('#mobile-tab-map').click();
    await expect(page.locator('.map-photo-thumb img').first()).toBeVisible({ timeout: 35_000 });
    await page.waitForTimeout(600);
    if (width === 390) {
      const attribution = await page.locator('.maplibregl-ctrl-attrib').boundingBox(), tabs = await page.locator('#mobile-tabs').boundingBox();
      expect(attribution!.y + attribution!.height).toBeLessThanOrEqual(tabs!.y);
    }
    await page.screenshot({ path: `${folder}/positron-${width}.png` });
  }
  expect(requests.every(item => item.method === 'GET')).toBe(true); expect(blocked).toEqual([]);
  expect(requests.some(item => item.path.startsWith('/fonts/'))).toBe(true);
  expect(requests.some(item => item.path.startsWith('/sprites/'))).toBe(true);
  writeFileSync(`${folder}/request-audit.json`, JSON.stringify({ hosts: [...new Set(requests.map(item => item.host))], methods: [...new Set(requests.map(item => item.method))], types: [...new Set(requests.map(item => item.path.split('/')[1]))], count: requests.length, blocked }, null, 2));
});

test('provider outage leaves photos, album map, and privacy information usable', async ({ page }) => {
  const ids = await seedUi(page);
  await page.route('https://tiles.openfreemap.org/**', route => route.abort('failed'));
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  await expect(page.locator('#map-status')).toContainText('読み込めませんでした');
  await expect(page.locator('#photo-list button').first()).toBeVisible();
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click(); await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await page.locator('#visit-focus-exit').click();
  await page.locator('#header-manage').click(); await page.locator('#basemap-privacy > summary').click();
  await expect(page.locator('#basemap-privacy')).toContainText('IPアドレス');
});
