import { expect, test, type Page } from '@playwright/test';

export async function localUi(page: Page, mapRequests?: string[]): Promise<string[]> {
  const origin = test.info().project.use.baseURL as string, unexpected: string[] = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url.startsWith('https://tiles.openfreemap.org/')) {
      mapRequests?.push(url);
      if (url.includes('/styles/')) return route.fulfill({ json: { version: 8,
        sources: { trial: { type: 'raster', tiles: ['https://tiles.openfreemap.org/trial/{z}/{x}/{y}.png'], tileSize: 256,
          attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors' } }, layers: [{ id: 'trial', type: 'raster', source: 'trial' }] } });
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48OEDAAWkAtFabOJuAAAAAElFTkSuQmCC', 'base64') });
    }
    unexpected.push(url); return route.abort('blockedbyclient');
  });
  return unexpected;
}
export async function createTripUi(page: Page, name: string) {
  await page.locator('#trip-select').selectOption('__create-trip__'); await page.locator('#trip-name').fill(name);
  await page.locator('#trip-create-submit').click(); await expect(page.locator('#trip-create-status')).toContainText('作成しました');
  await page.locator('#trip-create-submit').click(); await expect(page.locator('#trip-create-dialog')).not.toBeVisible();
  return page.locator('#trip-select').inputValue();
}

export async function photoListUi(page: Page) {
  if (page.viewportSize()!.width <= 700) await page.locator('#mobile-tab-photos').click();
  else {
    if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
    await page.locator('#left-tab-photos').click();
  }
}
