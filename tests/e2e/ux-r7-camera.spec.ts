import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
const folder = 'specs/ux-r7/screenshots/after';
async function probe(page: Page) {
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts');
    const original = PhotoMap.prototype.setViewportPadding;
    PhotoMap.prototype.setViewportPadding = function (...args) {
      Object.assign(window, { __r7Map: (this as unknown as { map: unknown }).map, __r7PhotoMap: this });
      return original.apply(this, args);
    };
  });
}
async function view(page: Page) {
  return page.evaluate(async () => {
    const map = (window as unknown as { __r7Map: import('maplibre-gl').Map }).__r7Map;
    const { mapViewportInsets } = await import('../../src/presentation/map-viewport.ts');
    const container = document.querySelector<HTMLElement>('#map')!;
    const bounds = container.getBoundingClientRect(), insets = mapViewportInsets(container);
    const collection = await (map.getSource('photos') as import('maplibre-gl').GeoJSONSource).getData() as import('geojson').GeoJSON;
    const points = collection.type === 'FeatureCollection' ? collection.features.flatMap(feature => {
      if (feature.geometry.type !== 'Point') return [];
      const projected = map.project(feature.geometry.coordinates as [number, number]);
      const hit = document.elementFromPoint(projected.x + bounds.left, projected.y + bounds.top);
      return [{ id: String(feature.id), x: projected.x, y: projected.y, unobscured: Boolean(hit?.closest('#map')) }];
    }) : [];
    return { camera: { center: map.getCenter().toArray(), zoom: map.getZoom(), padding: map.getPadding() }, points,
      visible: { left: insets.left, top: insets.top, right: bounds.width - insets.right, bottom: bounds.height - insets.bottom } };
  });
}
function contained(point: { x: number; y: number }, visible: { left: number; right: number; top: number; bottom: number }) {
  expect(point.x).toBeGreaterThanOrEqual(visible.left + 20);
  expect(point.x).toBeLessThanOrEqual(visible.right - 20);
  expect(point.y).toBeGreaterThanOrEqual(visible.top + 20);
  expect(point.y).toBeLessThanOrEqual(visible.bottom - 20);
}
async function shot(page: Page, name: string) {
  mkdirSync(folder, { recursive: true });
  await expect.poll(() => page.locator('#right-panel').evaluate(el => getComputedStyle(el).transform)).toBe('none');
  if (await page.locator('body').getAttribute('data-left-open') === 'true' && page.viewportSize()!.width > 700)
    await expect.poll(() => page.locator('#left-panel').evaluate(el => getComputedStyle(el).transform)).toBe('none');
  await page.screenshot({ path: `${folder}/${name}.png` });
}
async function openPhoto(page: Page, id: string) {
  await page.locator('#photo-search').fill('海辺の朝_');
  await page.locator(`#photo-list [data-photo-id="${id}"]`).click();
  await page.locator('#photo-search').fill('');
}

test('R7 desktop photo and fit operations avoid both panels without passive camera moves', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }); await probe(page);
  await openPhoto(page, ids.photos[0]!);
  const results = [];
  for (const [name, width, height] of [['pc1440-panels', 1440, 900], ['pc900-drawer', 900, 800]] as const) {
    await page.setViewportSize({ width, height });
    if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
    await page.getByRole('button', { name: '地図で見る', exact: true }).click();
    await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();
    const state = await view(page), target = state.points.find(point => point.id === ids.photos[0])!;
    contained(target, state.visible); expect(target.unobscured).toBe(true);
    expect(state.camera.padding).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    await shot(page, name); results.push({ name, ...state });
    const camera = (await view(page)).camera;
    await page.locator('#drawer-toggle').click(); await page.locator('#drawer-toggle').click();
    expect((await view(page)).camera).toEqual(camera);
    await page.locator('#photo-search').fill('海辺'); expect((await view(page)).camera).toEqual(camera);
    await page.locator('#photo-search').fill(''); expect((await view(page)).camera).toEqual(camera);
    await page.locator('#map-tools > summary').click(); await page.locator('#map-fit').click();
    const fitted = await view(page); expect(fitted.points).toHaveLength(23);
    for (const point of fitted.points) contained(point, fitted.visible);
    await page.locator('#map-tools > summary').click();
  }
  const camera = (await view(page)).camera;
  await page.locator('#right-close').click(); expect((await view(page)).camera).toEqual(camera);
  writeFileSync('specs/ux-r7/desktop-positions.json', JSON.stringify(results, null, 2));
});

test('R7 mobile preview uses its measured height and respects manual pan and rapid focus', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }); await probe(page);
  await openPhoto(page, ids.photos[0]!);
  const results = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
    await page.getByRole('button', { name: '地図で見る', exact: true }).click();
    await expect(page.locator('#mobile-tab-map')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();
    await page.evaluate(ids => {
      const photoMap = (window as unknown as { __r7PhotoMap: { focusPhoto(id: string): boolean } }).__r7PhotoMap;
      photoMap.focusPhoto(ids[16]!); photoMap.focusPhoto(ids[0]!);
    }, ids.photos);
    const state = await view(page), target = state.points.find(point => point.id === ids.photos[0])!;
    contained(target, state.visible); expect(target.unobscured).toBe(true);
    await shot(page, `mobile${width}-preview`); results.push({ name: `mobile${width}`, ...state });
    expect(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth)).toBe(false);
  }
  const before = (await view(page)).camera;
  const visible = (await view(page)).visible;
  const x = (visible.left + visible.right) / 2, y = (visible.top + visible.bottom) / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y + 25, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => JSON.stringify((await view(page)).camera.center)).not.toBe(JSON.stringify(before.center));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __r7Map: import('maplibre-gl').Map }).__r7Map.isMoving())).toBe(false);
  const manuallyAdjusted = (await view(page)).camera;
  await page.locator('#right-close').click();
  expect((await view(page)).camera).toEqual(manuallyAdjusted);
  writeFileSync('specs/ux-r7/mobile-positions.json', JSON.stringify(results, null, 2));
});

test('R7 album fit preserves filters and links and handles empty GPS-free identical and wide positions', async ({ page }) => {
  const ids = await seedUi(page); await probe(page);
  const fixtures = await page.evaluate(async ids => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newVisit } = await import('../../src/domain/visits');
    const { photoSchema } = await import('../../src/domain/model');
    const db = await LibraryDb.open(); const photos = await db.listPhotos(); db.close();
    const albums = ['空', 'GPSなし', '同じ地点', '広域'].map(name => newVisit(ids.trip, name));
    const positions = [[135, 34], [135, 34], [139.76, 35.68], [-123.12, 49.28], [151.2, -33.8]];
    const extra = positions.map(([longitude, latitude], index) => photoSchema.parse({ ...photos[0], id: crypto.randomUUID(), originalFilename: `追加合成${index}.jpg`,
      contentSha256: (index + 100).toString(16).padStart(64, '0'), thumbnailId: null, thumbnailState: 'not-attempted',
      sourceGps: { ...photos[0]!.sourceGps, status: 'valid', normalized: { longitude, latitude } } }));
    const links = [{ albumId: albums[1]!.id, photoId: ids.photos[23]!, createdAt: null },
      ...extra.map((photo, index) => ({ albumId: albums[index < 2 ? 2 : 3]!.id, photoId: photo.id, createdAt: null }))];
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('photo-route-library'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['photos', 'visits', 'photoAlbumLinks'], 'readwrite');
      for (const album of albums) transaction.objectStore('visits').add(album);
      for (const photo of extra) transaction.objectStore('photos').add(photo);
      for (const link of links) transaction.objectStore('photoAlbumLinks').add(link);
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
    }); database.close();
    return albums.map(album => album.id);
  }, ids);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip); await probe(page);
  await expect(page.locator('#map-zoom-level')).not.toContainText('準備中');
  await page.locator('#photo-search').fill('海辺');
  await page.locator('#map-tools > summary').click(); await page.locator('#map-mode-visits').click(); await page.locator('#map-tools > summary').click();
  const open = async (id: string) => {
    await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${id}"]`).click();
    await page.locator('#visit-summary').getByRole('button', { name: '地図で見る', exact: true }).click();
    await expect(page.locator('#visit-focus-banner')).toBeVisible();
  };
  const membership = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const links = await db.listPhotoAlbumLinks(); db.close(); return links;
  });
  for (const album of [ids.albums[0]!, ids.albums[1]!, ...fixtures]) {
    await open(album);
    const state = await view(page);
    const expected = membership.filter(link => link.albumId === album && link.photoId !== ids.photos[23]).map(link => link.photoId).sort();
    expect(state.points.map(point => point.id).sort()).toEqual(expected);
    expect(new Set(state.points.map(point => point.id)).size).toBe(state.points.length);
    for (const point of state.points) contained(point, state.visible);
    if (album === fixtures[2]) expect(state.camera.zoom).toBeGreaterThanOrEqual(17);
    if (album === fixtures[0] || album === fixtures[1]) {
      await expect(page.locator('#visit-focus-empty')).toBeVisible();
      const beforeFit = state.camera;
      await page.locator('#map-tools > summary').click(); await page.locator('#map-fit').click(); await page.locator('#map-tools > summary').click();
      expect((await view(page)).camera).toEqual(beforeFit);
    }
    const camera = (await view(page)).camera;
    await page.locator('#visit-focus-exit').click();
    expect((await view(page)).camera).toEqual(camera);
    await expect(page.locator('#photo-search')).toHaveValue('海辺');
    await expect(page.locator('#map-mode-visits')).toHaveAttribute('aria-pressed', 'true');
  }
});
