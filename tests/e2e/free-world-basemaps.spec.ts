import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48OEDAAWkAtFabOJuAAAAAElFTkSuQmCC', 'base64');
const fixtureStyle = { version: 8,
  sources: { names: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© OpenFreeMap · OpenMapTiles · OpenStreetMap' } },
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efeb' } },
    { id: 'names', type: 'symbol', source: 'names', layout: {} }] };

async function prepare(page: Page) {
  const ids = await seedUi(page), traffic: string[] = [], unexpected: string[] = [];
  await page.route('https://**/*', route => {
    const url = new URL(route.request().url()); traffic.push(url.href);
    if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/styles/')) return route.fulfill({ json: fixtureStyle });
    if (['tiles.maps.eox.at', 'tiles.mapterhorn.com', 'cyberjapandata.gsi.go.jp', 'basemap.nationalmap.gov'].includes(url.hostname)) return route.fulfill({ contentType: 'image/png', body: pixel });
    unexpected.push(url.href); return route.abort();
  });
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts');
    const original = PhotoMap.prototype.chooseBasemap;
    PhotoMap.prototype.chooseBasemap = function (id) {
      (window as unknown as { testMap: unknown }).testMap = (this as unknown as { map: unknown }).map;
      return original.call(this, id);
    };
  });
  await page.locator('#basemap-open').click(); await page.getByRole('radio', { name: '淡色', exact: true }).check();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
  return { ids, traffic, unexpected };
}

async function camera(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { testMap: { getCenter(): { lng: number; lat: number }; getZoom(): number } }).testMap;
    const center = map.getCenter(); return { lng: center.lng, lat: center.lat, zoom: map.getZoom() };
  });
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const records = await db.snapshot();
    const thumbnails = await Promise.all(records.thumbnails.map(async item => ({ ...item, blob: Array.from(new Uint8Array(await item.blob.arrayBuffer())) })));
    const result = { ...records, thumbnails, jobs: await db.listJobs(), recovery: await db.listRecovery() }; db.close(); return result;
  });
}

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });

test('four backgrounds retain camera, search, selected photo and all saved records', async ({ page }) => {
  const { traffic, unexpected } = await prepare(page);
  expect(traffic.some(url => /eox|mapterhorn|gsi.go.jp|nationalmap.gov/.test(url))).toBe(false);
  await page.keyboard.press('Escape'); await page.locator('#photo-search').fill('海辺');
  await page.locator('#photo-list [data-photo-id]').first().click();
  await expect(page.locator('#right-panel')).toBeVisible();
  const before = await snapshot(page), view = await camera(page);
  const detail = await page.locator('#photo-detail').textContent();
  for (const [label, id, source] of [['標準', 'standard', ''], ['航空・衛星写真', 'satellite', 'world-imagery'], ['地形', 'terrain', 'world-elevation'], ['淡色', 'muted', '']] as const) {
    await page.locator('#basemap-open').click(); await page.getByRole('radio', { name: label, exact: true }).check();
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-basemap', id);
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
    expect(await camera(page)).toEqual(view);
    await expect(page.locator('#photo-search')).toHaveValue('海辺');
    expect(await page.locator('#photo-detail').textContent()).toBe(detail);
    const sources = await page.evaluate(() => Object.keys((window as unknown as { testMap: { getStyle(): { sources: object } } }).testMap.getStyle().sources));
    expect(sources).toContain('photos'); expect(sources).toContain('visits');
    if (source) expect(sources).toContain(source);
    if (id !== 'satellite') expect(sources).not.toContain('world-imagery');
    if (id !== 'terrain') expect(sources).not.toContain('world-elevation');
    await page.keyboard.press('Escape');
  }
  expect(await snapshot(page)).toEqual(before); expect(unexpected).toEqual([]);
  expect(traffic.some(url => url.includes('tiles.maps.eox.at'))).toBe(true);
  expect(traffic.some(url => url.includes('tiles.mapterhorn.com'))).toBe(true);
});

test('background switching retains album focus and a blank click closes only the layer panel', async ({ page }) => {
  const { ids } = await prepare(page); await page.keyboard.press('Escape');
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  // Album focus intentionally closes its detail panel in the existing app.
  await expect(page.locator('#right-panel')).toBeHidden();
  const leftOpen = await page.locator('body').getAttribute('data-left-open');
  const view = await camera(page); await page.locator('#basemap-open').click();
  await page.getByRole('radio', { name: '地形', exact: true }).check();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
  expect(await camera(page)).toEqual(view); await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await page.locator('#map canvas').click({ position: { x: 750, y: 140 } });
  await expect(page.locator('#basemap-panel')).toBeHidden();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await expect(page.locator('#right-panel')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-left-open', leftOpen!);
});

test('regional imagery requests follow area and native zoom without credentials', async ({ page }) => {
  const { traffic, unexpected } = await prepare(page);
  const before = await snapshot(page);
  const jump = async (center: [number, number], zoom: number) => {
    // areTilesLoaded() can still describe the previous frame immediately after
    // jumpTo. Wait for the new view's idle event before counting its requests.
    await page.evaluate(({ center, zoom }) => new Promise<void>(resolve => {
      const map = (window as unknown as { testMap: { jumpTo(options: object): void; once(event: string, callback: () => void): void } }).testMap;
      map.once('idle', () => resolve()); map.jumpTo({ center, zoom });
    }), { center, zoom });
  };
  await jump([139.75, 35.68], 12);
  await page.getByRole('radio', { name: '航空・衛星写真', exact: true }).check();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
  await jump([139.75, 35.68], 12);
  const regional = () => traffic.filter(url => /gsi.go.jp|nationalmap.gov/.test(url));
  expect(regional()).toEqual([]);
  await jump([139.75, 35.68], 19);
  await expect.poll(() => traffic.filter(url => url.includes('cyberjapandata.gsi.go.jp')).length).toBeGreaterThan(0);
  const japanCount = regional().length;
  expect(regional().every(url => /seamlessphoto\/18\//.test(url))).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Axelspace');
  await jump([2.35, 48.86], 18);
  expect(regional()).toHaveLength(japanCount);
  await jump([-77.04, 38.90], 19);
  await expect.poll(() => traffic.filter(url => url.includes('basemap.nationalmap.gov')).length).toBeGreaterThan(0);
  const american = regional().filter(url => url.includes('nationalmap.gov'));
  expect(american.every(url => /MapServer\/tile\/16\//.test(url))).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('USDA');
  const count = regional().length;
  await jump([-150, 64], 18); // Alaska is intentionally outside this release.
  expect(regional()).toHaveLength(count);
  expect(regional().every(url => new URL(url).search === '')).toBe(true);
  expect(unexpected).toEqual([]); expect(await snapshot(page)).toEqual(before);
});

test('regional 404 leaves global imagery usable and offers retry without a data change', async ({ page }) => {
  const { traffic } = await prepare(page);
  const before = await snapshot(page);
  let missingRequests = 0;
  await page.route('https://cyberjapandata.gsi.go.jp/**', route => { missingRequests++; return route.fulfill({ status: 404, body: 'Synthetic missing region' }); });
  await page.getByRole('radio', { name: '航空・衛星写真', exact: true }).check();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => (window as unknown as { testMap: { jumpTo(options: object): void } }).testMap.jumpTo({ center: [139.75, 35.68], zoom: 18 }));
  const view = await camera(page);
  await expect.poll(() => missingRequests).toBeGreaterThan(0);
  await expect(page.locator('#basemap-load-status')).toContainText('一部の航空写真');
  await expect(page.locator('#app-error')).toBeHidden();
  await expect(page.locator('#basemap-panel').getByRole('button', { name: '再試行', exact: true })).toBeVisible();
  expect(traffic.some(url => url.includes('tiles.maps.eox.at'))).toBe(true);
  expect(await camera(page)).toEqual(view);
  await page.route('https://cyberjapandata.gsi.go.jp/**', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await page.locator('#basemap-panel').getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#basemap-load-status')).toBeEmpty();
  expect(await snapshot(page)).toEqual(before);
});

test('a stale response cannot replace a newer choice; failed style retries the requested background', async ({ page }) => {
  await prepare(page); let fail = false;
  await page.route('https://tiles.openfreemap.org/styles/liberty', async route => {
    if (fail) return route.fulfill({ status: 503, body: 'Synthetic unavailable' });
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.fulfill({ json: fixtureStyle }).catch(() => {});
  });
  await page.getByRole('radio', { name: '航空・衛星写真', exact: true }).check();
  await page.getByRole('radio', { name: '淡色', exact: true }).check();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
  await page.waitForTimeout(750);
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-basemap', 'muted');
  fail = true; const view = await camera(page);
  await page.getByRole('radio', { name: '地形', exact: true }).check();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#basemap-load-status')).toContainText('前の表示を保持');
  expect(await camera(page)).toEqual(view);
  fail = false; await page.locator('#basemap-panel').getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('radio', { name: '地形', exact: true })).toBeChecked();
});

test('layer controls fit desktop and mobile, with keyboard access and visible attribution', async ({ page }) => {
  await prepare(page); await page.keyboard.press('Escape');
  mkdirSync('test-results/free-basemaps', { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 700) await page.locator('#mobile-tab-map').click();
    await page.locator('#basemap-open').click();
    await expect(page.getByRole('radio', { name: '淡色', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
    for (const selector of ['#basemap-open', '#basemap-panel']) {
      const box = await page.locator(selector).boundingBox(); expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y).toBeGreaterThanOrEqual(58); expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    }
    const button = await page.locator('#basemap-open').boundingBox(); expect(button!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Mapterhorn');
    const attribution = await page.locator('.maplibregl-ctrl-attrib').boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(attribution!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/free-basemaps/panel-${width}.png` });
    await page.keyboard.press('Escape'); await expect(page.locator('#basemap-open')).toBeFocused();
    // Reset to the same starting radio for the next viewport.
    await page.locator('#basemap-open').click(); await page.getByRole('radio', { name: '淡色', exact: true }).check();
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready'); await page.keyboard.press('Escape');
  }
});

test('imagery tile failure is reported independently of the name source, and switching recovers', async ({ page }) => {
  await prepare(page);
  await page.route('https://tiles.maps.eox.at/**', route => route.fulfill({ status: 503, body: 'Synthetic tile outage' }));
  await page.getByRole('radio', { name: '航空・衛星写真', exact: true }).check();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'error', { timeout: 12_000 });
  await expect(page.locator('#basemap-panel').getByRole('button', { name: '再試行', exact: true })).toBeVisible();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('EOxCloudless');
  await page.getByRole('radio', { name: '淡色', exact: true }).check();
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#app-error')).toBeHidden();
});

test('an unresponsive imagery source has a deadline even after the style has loaded', async ({ page }) => {
  await prepare(page); await page.clock.install();
  const releases: (() => void)[] = [];
  await page.route('https://tiles.maps.eox.at/**', async route => {
    await new Promise<void>(resolve => releases.push(resolve));
    await route.fulfill({ contentType: 'image/png', body: pixel }).catch(() => {});
  });
  try {
    await page.getByRole('radio', { name: '航空・衛星写真', exact: true }).check();
    await expect.poll(() => releases.length).toBeGreaterThan(0);
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'loading');
    await page.clock.fastForward(16_000);
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#basemap-load-status')).toContainText('時間がかかっています');
  } finally { for (const release of releases) release(); }
});

test('middle-width drawers, short mobile previews and album banners leave controls usable', async ({ page }) => {
  const { ids } = await prepare(page); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.locator('#drawer-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#drawer-toggle').click();
  await page.locator('#photo-search').fill('海辺-1.jpg');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await expect(page.locator('#right-panel')).toBeVisible();
  await expect(page.locator('#drawer-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#drawer-toggle').click();
  for (const width of [900, 800]) {
    await page.setViewportSize({ width, height: 700 });
    if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
    await page.locator('#basemap-open').hover();
    await expect(page.locator('#basemap-panel')).toBeVisible();
    await expect(page.locator('#drawer-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#basemap-open').click();
    await expect(page.locator('#drawer-toggle')).toHaveAttribute('aria-expanded', 'false');
    const panel = await page.locator('#basemap-panel').boundingBox(), right = await page.locator('#right-panel').boundingBox(), drawer = await page.locator('#drawer-toggle').boundingBox();
    expect(panel!.y >= drawer!.y + drawer!.height || panel!.y + panel!.height <= drawer!.y || panel!.x >= drawer!.x + drawer!.width).toBe(true);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(right!.x);
    for (const input of await page.getByRole('radio').all()) {
      expect(await input.evaluate(element => { const box = element.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element; })).toBe(true);
    }
    await expect(page.locator('#photo-search')).toHaveValue('海辺-1.jpg');
    await page.getByRole('radio', { name: '淡色', exact: true }).check(); await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 320, height: 568 });
  // Open the map while retaining the selected photo's preview through its explicit action.
  await page.locator('#photo-detail').getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('#right-panel')).toBeVisible();
  await page.locator('#basemap-open').click();
  const selected = page.getByRole('radio', { name: '淡色', exact: true }); await expect(selected).toBeFocused();
  const selectedBox = await selected.boundingBox(), mobilePanel = await page.locator('#basemap-panel').boundingBox();
  expect(selectedBox!.y).toBeGreaterThanOrEqual(mobilePanel!.y);
  expect(selectedBox!.y + selectedBox!.height).toBeLessThanOrEqual(mobilePanel!.y + mobilePanel!.height);
  expect(await selected.evaluate(input => {
    const box = input.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === input;
  })).toBe(true);
  await page.locator('#basemap-more').click();
  await page.locator('.basemap-info > summary').click();
  await expect(page.locator('.basemap-credits')).toContainText('OpenStreetMap');
  await page.screenshot({ path: 'test-results/free-basemaps/preview-panel-320x568.png' });
  const dock = await page.locator('#basemap-open').boundingBox();
  await page.mouse.move(dock!.x + dock!.width / 2, dock!.y + dock!.height / 2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300); await expect(page.locator('#basemap-panel')).toBeHidden();
  await page.mouse.move(300, 60); await page.locator('#basemap-open').click();
  await page.locator('#basemap-open').click();
  await expect(page.locator('#basemap-panel')).toBeHidden(); await page.locator('#right-close').click();
  await page.locator('#mobile-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  const toggle = await page.locator('#basemap-open').boundingBox(), banner = await page.locator('#visit-focus-banner').boundingBox();
  expect(banner!.y + banner!.height).toBeLessThanOrEqual(toggle!.y);
});

test('date-line fit and selection use the visible world copy without changing stored GPS', async ({ page }) => {
  await prepare(page); await page.keyboard.press('Escape');
  const result = await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts');
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    const db = await LibraryDb.open(); const records = await db.listPhotos(); db.close();
    const photos = records.slice(0, 2).map((photo, index) => ({ ...photo, sourceGps: { ...photo.sourceGps,
      normalized: { longitude: index ? -179 : 179, latitude: -20 }, datum: 'WGS-84' } }));
    // Separate display-only map instance; no record is written to the database.
    const container = document.createElement('div'); container.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:600px'; document.body.append(container);
    const map = new PhotoMap(container, document.createElement('p'), () => {}, undefined, undefined, undefined, undefined,
      { style: { version: 8, sources: {}, layers: [] }, attribution: null, externalRequests: false });
    const native = (map as unknown as { map: import('maplibre-gl').Map }).map;
    await new Promise<void>(resolve => native.once('load', () => resolve()));
    map.update(photos, []); const before = { lng: native.getCenter().lng, zoom: native.getZoom() };
    map.selectPhoto(photos[1]!.id); map.revealPhoto(photos[1]!.id);
    const after = { lng: native.getCenter().lng, zoom: native.getZoom() };
    native.remove(); container.remove(); return { before, after, stored: records.slice(0, 2).map(photo => photo.sourceGps.normalized) };
  });
  expect(Math.abs(result.before.lng)).toBeCloseTo(180, 3);
  expect(result.after).toEqual(result.before);
  expect(result.stored.every(point => point && point.longitude > 120 && point.longitude < 140)).toBe(true);
});


test('mouse hover opens a compact chooser without focus, map changes or extra requests', async ({ page }) => {
  const { traffic } = await prepare(page);
  await page.keyboard.press('Escape'); await page.mouse.move(800, 100);
  await page.locator('#photo-search').focus();
  const focusBefore = await page.evaluate(() => document.activeElement?.id), view = await camera(page), requestsBefore = traffic.length;
  await page.locator('#basemap-open').hover();
  await expect(page.locator('#basemap-panel')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focusBefore);
  expect(await camera(page)).toEqual(view); expect(traffic.length).toBe(requestsBefore);
  await expect(page.locator('.basemap-note')).toBeHidden();
  const box = await page.locator('#basemap-panel').boundingBox();
  expect(box!.height).toBeLessThanOrEqual(82); expect(box!.width).toBeLessThanOrEqual(304);
  const dock = await page.locator('#basemap-open').boundingBox();
  expect(dock!.width).toBe(60); expect(dock!.height).toBe(60);
  await expect(page.getByRole('button', { name: 'レイヤーを閉じる', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: '標準', exact: true }).hover();
  await page.waitForTimeout(300); await expect(page.locator('#basemap-panel')).toBeVisible();
  await page.mouse.move(800, 100); await expect(page.locator('#basemap-panel')).toBeHidden();
  await page.locator('#basemap-open').hover(); await expect(page.locator('#basemap-panel')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#basemap-panel')).toBeHidden();
  await page.waitForTimeout(300); await expect(page.locator('#basemap-panel')).toBeHidden();
  await page.mouse.move(800, 100); await page.locator('#basemap-open').hover();
  await expect(page.locator('#basemap-panel')).toBeVisible();
  await page.locator('#basemap-open').click(); await page.mouse.move(800, 100);
  await page.waitForTimeout(300); await expect(page.locator('#basemap-panel')).toBeVisible();
  await page.locator('#basemap-open').click();
  await expect(page.locator('#basemap-panel')).toBeHidden();
});

test('touch opens the same compact chooser without a hover prerequisite', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await prepare(page); await page.keyboard.press('Escape');
    await page.locator('#basemap-open').click();
    await expect(page.locator('#basemap-panel')).toBeVisible();
    await page.getByRole('radio', { name: '標準', exact: true }).check();
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-basemap', 'standard');
    await page.locator('#basemap-open').click();
    await expect(page.locator('#basemap-panel')).toBeHidden();
  } finally { await context.close(); }
});

test('more preserves the compact four and selects additional maps without changing photos or camera', async ({ page }) => {
  const { traffic, unexpected } = await prepare(page);
  await page.keyboard.press('Escape');
  await page.locator('#photo-list [data-photo-id]').first().click();
  const before = await snapshot(page), view = await camera(page), detail = await page.locator('#photo-detail').textContent();
  await page.locator('#basemap-open').click();
  await expect(page.getByRole('radio')).toHaveCount(4);
  const requests = traffic.length;
  await page.getByRole('button', { name: 'もっと見る', exact: true }).click();
  await expect(page.locator('#basemap-more')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('radio', { name: '鉄道', exact: true })).toBeFocused();
  await expect(page.getByRole('radio', { name: '鉄道', exact: true })).not.toBeChecked();
  expect(traffic.length).toBe(requests); expect(await camera(page)).toEqual(view);
  await expect(page.locator('#basemap-control')).toHaveAttribute('data-basemap', 'muted');
  for (const [name, id] of [['鉄道', 'rail'], ['散策', 'outdoor'], ['ダーク', 'dark']] as const) {
    await page.getByRole('radio', { name, exact: true }).check();
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-basemap', id);
    await expect(page.locator('#basemap-more')).toHaveAttribute('data-selected', 'true');
    expect(await camera(page)).toEqual(view); expect(await page.locator('#photo-detail').textContent()).toBe(detail);
  }
  const info = page.locator('.basemap-info > summary');
  await expect(info).toHaveAccessibleName('地図の詳細・出典');
  await info.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.basemap-credits')).toContainText('OpenStreetMap');
  await page.keyboard.press('Escape'); await expect(page.locator('#basemap-panel')).toBeHidden();
  await expect(page.locator('#basemap-more')).toHaveAttribute('aria-expanded', 'false');
  await page.mouse.move(800, 100); await page.locator('#basemap-open').hover();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await page.locator('#basemap-open').click();
  await expect(page.getByRole('radio', { name: 'ダーク', exact: true })).toBeFocused();
  expect(await snapshot(page)).toEqual(before); expect(unexpected).toEqual([]);
  expect(traffic.some(url => url === 'https://tiles.openfreemap.org/styles/dark')).toBe(true);
});

test('more remains usable on short touch screens and retries an additional style', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  try {
    await prepare(page); await page.keyboard.press('Escape'); await page.locator('#mobile-tab-map').click();
    await page.locator('#basemap-open').click(); await page.locator('#basemap-more').click();
    let fail = true;
    await page.route('https://tiles.openfreemap.org/styles/dark', route => fail ? route.fulfill({ status: 503, body: 'Synthetic unavailable' }) : route.fulfill({ json: fixtureStyle }));
    await page.getByRole('radio', { name: 'ダーク', exact: true }).check();
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'error');
    const view = await camera(page); fail = false;
    await page.locator('#basemap-panel').getByRole('button', { name: '再試行', exact: true }).click();
    await expect(page.locator('#basemap-control')).toHaveAttribute('data-state', 'ready');
    expect(await camera(page)).toEqual(view);
    const choice = page.getByRole('radio', { name: 'ダーク', exact: true });
    await choice.scrollIntoViewIfNeeded();
    expect(await choice.evaluate(input => { const box = input.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === input; })).toBe(true);
    mkdirSync('test-results/more-basemaps', { recursive: true });
    await page.screenshot({ path: 'test-results/more-basemaps/more-320x568.png' });
    const info = page.locator('.basemap-info > summary');
    const panelBox = await page.locator('#basemap-panel').boundingBox(), infoBox = await info.boundingBox();
    expect(infoBox!.y + infoBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
    expect(infoBox!.height).toBeGreaterThanOrEqual(44);
    await page.locator('#mobile-tab-photos').click(); await expect(page.locator('#basemap-panel')).toBeHidden();
  } finally { await context.close(); }
});
