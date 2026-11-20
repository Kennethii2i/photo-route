import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
const style = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efeb' } }] };
async function shot(page: Page, name: string) {
  mkdirSync('specs/ux-r10/screenshots', { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `specs/ux-r10/screenshots/${name}.png`, animations: 'disabled' });
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const { trips, visits, photos, links } = await db.snapshot(); const history = await db.listRecovery(); db.close(); return { trips, visits, photos, links, history };
  });
}
async function probeMap(page: Page) {
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts'); const padding = PhotoMap.prototype.setViewportPadding;
    PhotoMap.prototype.setViewportPadding = function (...args) {
      Object.assign(window, { __r10Map: (this as unknown as { map: unknown }).map }); return padding.apply(this, args);
    };
  });
}

test('R10 style retry retains camera selection and data; single tile errors are quiet and outages are deduplicated', async ({ page }) => {
  const ids = await seedUi(page); const before = await snapshot(page); await expect(page.locator('#app-error')).toBeHidden();
  await probeMap(page); await page.locator('#photo-search').fill('海辺-1.jpg');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click(); await page.waitForFunction(() => '__r10Map' in window);
  await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();
  const camera = await page.evaluate(() => { const map = (window as unknown as { __r10Map: import('maplibre-gl').Map }).__r10Map; return { center: map.getCenter().toArray(), zoom: map.getZoom() }; });
  let failStyle = true;
  await page.route('https://tiles.openfreemap.org/styles/positron', route => failStyle ? route.abort('internetdisconnected') : route.fulfill({ json: style }));
  await page.evaluate(() => (window as unknown as { __r10Map: import('maplibre-gl').Map }).__r10Map.setStyle('https://tiles.openfreemap.org/styles/positron', { diff: false }));
  await expect(page.locator('#app-error-title')).toHaveText('地図を読み込めませんでした'); await expect(page.locator('#photo-count')).toContainText('1件');
  await shot(page, 'ux-r10-pc1440-map-error'); failStyle = false;
  await page.locator('#app-error-action').click(); await expect(page.locator('#app-error')).toBeHidden();
  await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();
  expect(await page.evaluate(() => { const map = (window as unknown as { __r10Map: import('maplibre-gl').Map }).__r10Map; return { center: map.getCenter().toArray(), zoom: map.getZoom() }; })).toEqual(camera);
  await page.evaluate(() => {
    const map = (window as unknown as { __r10Map: import('maplibre-gl').Map }).__r10Map;
    map.fire('error', { error: new Error('synthetic single tile'), sourceId: 'background', tile: { tileID: { key: 'one' } } });
  });
  await page.waitForTimeout(1700); await expect(page.locator('#app-error')).toBeHidden();
  await page.evaluate(() => {
    const map = (window as unknown as { __r10Map: import('maplibre-gl').Map }).__r10Map;
    for (let index = 0; index < 6; index++) map.fire('error', { error: new Error('synthetic tiles'), sourceId: 'background', tile: { tileID: { key: String(index) } } });
  });
  await expect(page.locator('#app-error-title')).toHaveText('地図を読み込めませんでした'); await expect(page.locator('#app-error')).toHaveCount(1);
  await page.locator('#app-error-action').click(); await expect(page.locator('#app-error')).toBeHidden();
  await page.waitForFunction(() => (window as unknown as { __r10Map: import('maplibre-gl').Map }).__r10Map.isStyleLoaded());
  await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await expect(page.locator('#app-error')).toBeVisible();
  await page.locator('#app-error-action').click(); await expect(page.locator('#app-error')).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
});

test('R10 DB open errors and blocked callback are visible without management and unavailable controls cannot save', async ({ page }) => {
  const origin = `http://127.0.0.1:${process.env.PHOTO_ROUTE_TEST_PORT}`;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.route('**/src/infrastructure/storage.ts', async route => {
    const response = await route.fetch(); const source = await response.text();
    const needle = 'const opened = indexedDB.open(name, DB_VERSION);'; expect(source).toContain(needle);
    await route.fulfill({ response, body: source.replace(needle, `
      if (!sessionStorage.getItem('r10-open-ok')) throw new DOMException('synthetic blocked storage', 'UnknownError');
      if (sessionStorage.getItem('r10-blocked')) { options.onBlocked?.(); await new Promise(resolve => { window.__r10ReleaseOpen = resolve; }); }
      ${needle}`) });
  });
  await page.goto('/'); await expect(page.locator('#app-error-title')).toHaveText('保存領域を開けません');
  expect(await page.locator('main').evaluate(element => (element as HTMLElement).inert)).toBe(true);
  expect(await page.locator('.header-actions').evaluate(element => (element as HTMLElement).inert)).toBe(true);
  await expect(page.locator('#header-add')).toBeDisabled();
  await shot(page, 'ux-r10-pc1440-db-open-error');
  await page.evaluate(() => { sessionStorage.setItem('r10-open-ok', '1'); sessionStorage.setItem('r10-blocked', '1'); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#app-error-action').click();
  await expect(page.locator('#app-error-title')).toHaveText('ほかのPhoto Routeタブを閉じてください');
  await page.locator('#app-error summary').click(); await expect(page.locator('#app-error')).toContainText('閉じると読み込みを続行');
  await shot(page, 'ux-r10-mobile390-db-blocked');
  await page.evaluate(() => (window as unknown as { __r10ReleaseOpen(): void }).__r10ReleaseOpen());
  await expect(page.locator('#app-error')).toBeHidden(); await expect(page.locator('#photo-count')).toHaveText('0件');
  expect(await page.locator('main').evaluate(element => (element as HTMLElement).inert)).toBe(false);
});

test('R10 read-only retry preserves records; quota never resends writes and map initialization failure leaves the library usable', async ({ page }) => {
  const ids = await seedUi(page), before = await snapshot(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.listPhotos;
    LibraryDb.prototype.listPhotos = function () {
      return (window as unknown as { __r10ReadsAllowed?: boolean }).__r10ReadsAllowed ? original.call(this) : Promise.reject(new Error('synthetic read failure'));
    };
  });
  await page.locator('#trip-select').selectOption(ids.trip); await expect(page.locator('#app-error-title')).toHaveText('保存済みデータを読み込めません');
  await expect(page.locator('#photo-count')).toContainText('24件');
  await page.evaluate(() => { Object.assign(window, { __r10ReadsAllowed: true }); });
  await page.locator('#app-error-action').click(); await expect(page.locator('#app-error')).toBeHidden(); expect(await snapshot(page)).toEqual(before);
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '写真を選択', exact: true }).click(); await page.locator('#vpe-search').fill('街並み-23.jpg');
  await page.locator(`#vpe-list [data-tile-id="${ids.photos[22]}"] input`).check();
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    LibraryDb.prototype.saveAlbumMembershipBatch = async () => {
      Object.assign(window, { __r10Writes: Number((window as unknown as { __r10Writes?: number }).__r10Writes ?? 0) + 1 });
      throw new DOMException('synthetic full disk', 'QuotaExceededError');
    };
  });
  await page.locator('#vpe-save').click(); await expect(page.locator('#app-error-title')).toHaveText('端末の保存領域が不足しています');
  await expect(page.locator('#app-error-action')).toBeHidden(); await expect(page.locator('#undo-notice')).toBeHidden();
  await page.locator('#vpe-cancel').click(); await page.locator('#vpe-leave-discard').click();
  await page.setViewportSize({ width: 390, height: 844 }); await shot(page, 'ux-r10-mobile390-quota');
  await page.setViewportSize({ width: 320, height: 740 }); await shot(page, 'ux-r10-mobile320-quota');
  expect(await page.evaluate(() => (window as unknown as { __r10Writes: number }).__r10Writes)).toBe(1); expect(await snapshot(page)).toEqual(before);
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, receiver, args: unknown[]) { return String(args[0]).includes('webgl') ? null : Reflect.apply(target, receiver, args); },
    });
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  await expect(page.locator('#app-error-title')).toHaveText('地図を起動できませんでした');
  await page.locator('#mobile-tab-photos').click(); await expect(page.locator('#photo-count')).toContainText('24件'); expect(await snapshot(page)).toEqual(before);
});
