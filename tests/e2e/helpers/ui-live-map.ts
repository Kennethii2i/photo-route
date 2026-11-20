import { expect, type Page } from '@playwright/test';
import { seedUi } from './ui-package';

export async function seedLiveUi(page: Page, options: Parameters<typeof seedUi>[1] = {}) {
  const ids = await seedUi(page, options);
  const testOrigin = `http://127.0.0.1:${process.env.PHOTO_ROUTE_TEST_PORT ?? '5184'}`;
  await page.unroute('**/*');
  const audit = { successfulTiles: 0, blocked: [] as string[], failed: [] as string[] };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === testOrigin) return route.continue();
    if (url.origin === 'https://tiles.openfreemap.org' && route.request().method() === 'GET') return route.continue();
    audit.blocked.push(url.origin); return route.abort();
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname !== 'tiles.openfreemap.org') return;
    if (!response.ok()) audit.failed.push(`${response.status()} ${url.pathname}`);
    else if (url.pathname.startsWith('/planet/') && url.pathname.endsWith('.pbf')) audit.successfulTiles++;
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.hostname === 'tiles.openfreemap.org' && request.failure()?.errorText !== 'net::ERR_ABORTED') audit.failed.push(url.pathname);
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  await expect.poll(() => audit.successfulTiles, { timeout: 35_000 }).toBeGreaterThan(0);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap', { timeout: 35_000 });
  await expect(page.locator('.map-photo-thumb img').first()).toBeVisible({ timeout: 35_000 });
  await page.waitForTimeout(900);
  await expect(page.locator('#map-status')).not.toContainText('読み込めませんでした');
  return { ...ids, audit };
}
