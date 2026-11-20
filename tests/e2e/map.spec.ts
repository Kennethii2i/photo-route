import { expect, test } from '@playwright/test';

test('P0-T08 MapLibre renders synthetic points with keyboard list alternative', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5184/')) external.push(request.url()); });
  await page.goto('/spikes/p0-t08/map.html');
  await expect(page.locator('#map')).toHaveAttribute('data-state', 'loaded');
  await page.waitForFunction(() => {
    const map = (window as Window & { phase0Map?: import('maplibre-gl').Map }).phase0Map;
    return map?.isStyleLoaded() && map.queryRenderedFeatures(map.project([139.7, 35.6]), { layers: ['synthetic-photo-points'] }).length > 0;
  });
  const mapState = await page.evaluate(() => {
    const map = (window as Window & { phase0Map?: import('maplibre-gl').Map }).phase0Map!;
    const pixel = map.project([139.7, 35.6]);
    return { layer: Boolean(map.getLayer('synthetic-photo-points')), features: map.queryRenderedFeatures(pixel, { layers: ['synthetic-photo-points'] }).length, canvas: Boolean(document.querySelector('#map canvas')), styleLoaded: map.isStyleLoaded() };
  });
  console.log(`P0-T08 map ${JSON.stringify({ ...mapState, external })}`);
  expect(mapState.layer).toBe(true);
  expect(mapState.canvas).toBe(true);
  expect(mapState.features).toBeGreaterThan(0);
  await page.getByRole('button', { name: '合成地点 A' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection')).toContainText('合成地点 A を選択');
  expect(external).toEqual([]);
});

test('P0-T08 local style failure leaves keyboard list available', async ({ page }) => {
  await page.goto('/spikes/p0-t08/map.html?fail=1');
  await expect(page.locator('#map')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('#status')).toContainText('地点一覧');
  await page.getByRole('button', { name: '合成地点 B' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection')).toContainText('合成地点 B を選択');
});

test('P0-T08 official demo basemap has only documented map requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5184/')) external.push(request.url()); });
  await page.goto('/spikes/p0-t08/map.html?demo=1');
  await expect(page.locator('#map')).toHaveAttribute('data-state', 'loaded', { timeout: 15_000 });
  await page.waitForTimeout(1000);
  const attributionControl = page.locator('.maplibregl-ctrl-attrib');
  await expect(attributionControl).toHaveCount(1);
  const attribution = await attributionControl.textContent();
  console.log(`P0-T08 demo ${JSON.stringify({ requests: external, attribution })}`);
  expect(external.length).toBeGreaterThan(0);
  expect(external.every(url => new URL(url).hostname === 'demotiles.maplibre.org')).toBe(true);
  expect(external.every(url => !url.includes('synthetic-a') && !url.includes('synthetic-b'))).toBe(true);
});
