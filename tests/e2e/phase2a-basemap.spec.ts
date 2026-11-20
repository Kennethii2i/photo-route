import { expect, test } from '@playwright/test';

test('external basemap is opt-in, credited, and off again after reload', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://tiles.openfreemap.org/**', route => {
    requests.push(route.request().url());
    if (route.request().url().includes('/styles/liberty')) {
      void route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8,
        sources: { trial: { type: 'raster', tiles: ['https://tiles.openfreemap.org/trial/{z}/{x}/{y}.png'], tileSize: 256,
          attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors' } },
        layers: [{ id: 'trial', type: 'raster', source: 'trial' }] }) });
    } else void route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48OEDAAWkAtFabOJuAAAAAElFTkSuQmCC', 'base64') });
  });
  await page.goto('/');
  await expect(page.locator('#basemap-toggle')).not.toBeChecked();
  await expect(page.locator('#basemap-privacy')).toContainText('tiles.openfreemap.org');
  await expect(page.locator('#basemap-privacy')).toContainText('閲覧地域');
  expect(requests).toHaveLength(0);
  await page.locator('#map-tools > summary').click();
  await page.locator('#basemap-toggle').click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.locator('#map-status')).toContainText('OpenFreeMapの背景地図を表示');
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  await page.locator('#basemap-toggle').uncheck();
  await expect(page.locator('#map-status')).toContainText('現在オフ');
  const afterOff = requests.length;
  await page.reload();
  await expect(page.locator('#basemap-toggle')).not.toBeChecked();
  await expect(page.locator('#map-status')).toContainText('現在オフ');
  expect(requests.length).toBe(afterOff);
});

test('basemap outage falls back without losing photo list or detail', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://tiles.openfreemap.org/**', route => { requests.push(route.request().url()); void route.abort('failed'); });
  await page.goto('/');
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles('fixtures/generated/jpeg_gps_offset_orientation6.jpg');
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#management-close').click();
  expect(requests).toHaveLength(0);
  await page.locator('#map-tools > summary').click();
  await page.locator('#basemap-toggle').click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.locator('#basemap-toggle')).not.toBeChecked();
  await expect(page.locator('#map-status')).toContainText('読み込めませんでした');
  await page.locator('#photo-list button').click();
  await expect(page.locator('#photo-detail')).toContainText('位置情報あり');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
});
