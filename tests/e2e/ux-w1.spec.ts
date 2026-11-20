import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';
import { probe, camera, records, seedGroup } from './helpers/coincident-photos';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function photoList(page: Page) {
  if (page.viewportSize()!.width <= 700) await page.locator('#mobile-tab-photos').click();
  else { if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click(); await page.locator('#left-tab-photos').click(); }
}
async function position(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(({ center, zoom }) => { (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map.easeTo({ center, zoom, duration: 0 }); }, { center, zoom });
  await page.waitForFunction(() => !(window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map.isMoving());
}
async function visiblePoint(page: Page, id: string) {
  await expect.poll(() => page.evaluate(async id => {
    const { mapViewportInsets } = await import('../../src/presentation/map-viewport');
    const map = (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map;
    const source = await (map.getSource('photos') as import('maplibre-gl').GeoJSONSource).getData() as GeoJSON.FeatureCollection<GeoJSON.Point>;
    const feature = source.features.find(f => f.properties?.id === id); if (!feature) return { visible: false };
    const p = map.project(feature.geometry.coordinates as [number, number]), container = map.getContainer(), insets = mapViewportInsets(container);
    return { visible: p.x >= insets.left + 30 && p.x <= container.clientWidth - insets.right - 30 && p.y >= insets.top + 30 && p.y <= container.clientHeight - insets.bottom - 30,
      x: p.x, y: p.y, insets, width: container.clientWidth, height: container.clientHeight };
  }, id)).toMatchObject({ visible: true }).catch(async error => {
    console.log('visible-point failure', await page.evaluate(async id => {
      const { mapViewportInsets } = await import('../../src/presentation/map-viewport');
      const map = (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map;
      const data = await (map.getSource('photos') as import('maplibre-gl').GeoJSONSource).getData() as GeoJSON.FeatureCollection<GeoJSON.Point>;
      const point = data.features.find(f => f.properties?.id === id);
      return { position: point ? map.project(point.geometry.coordinates as [number, number]) : null, insets: mapViewportInsets(map.getContainer()), camera: map.getCenter(), zoom: map.getZoom(), width: innerWidth, rightOpen: document.body.dataset.rightOpen };
    }, id)); throw error;
  });
}
async function shot(page: Page, name: string) {
  mkdirSync('specs/ux-w1/screenshots', { recursive: true }); await page.screenshot({ path: `specs/ux-w1/screenshots/${name}.png`, animations: 'disabled' });
}

test('W1 selection preserves zoom, pans only when obscured, and rapid/no-GPS/reference selections stay safe', async ({ page }) => {
  const ids = await seedUi(page);
  await page.evaluate(async ids => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(), photos = await db.listPhotos();
    await new Promise<void>((resolve, reject) => {
      const tx = (db as unknown as { db: IDBDatabase }).db.transaction('photos', 'readwrite');
      for (const [index, longitude] of [[16, 129.87], [17, 130.7], [18, 129.9]]) {
        const p = photos.find(p => p.id === ids.photos[index!])!; p.sourceGps.normalized = { latitude: 32.73, longitude: longitude! };
        if (index === 18) p.sourceGps = { rawTags: { GPSLatitudeRef: 'N', GPSLatitude: [[32, 1], [43, 1], [48, 1]], GPSLongitudeRef: 'E', GPSLongitude: [[129, 1], [54, 1], [0, 1]] }, normalized: null, datum: null, status: 'suspect', horizontalErrorMeters: null, issues: [] };
        tx.objectStore('photos').put(p);
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, ids);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip); await probe(page); await photoList(page);
  const before = await records(page);
  const tile = (index: number) => page.locator(`#photo-list [data-photo-id="${ids.photos[index]}"]`);
  await position(page, [129.87, 32.73], 13); await tile(16).click(); await visiblePoint(page, ids.photos[16]!);
  expect((await camera(page)).zoom).toBeCloseTo(13, 7);
  const visibleCamera = await camera(page); await tile(16).click(); await expect(page.locator('#right-panel')).toBeHidden(); expect(await camera(page)).toEqual(visibleCamera);
  await tile(16).click(); await visiblePoint(page, ids.photos[16]!); expect(await camera(page)).toEqual(visibleCamera);
  const old = await camera(page); await tile(17).click(); await visiblePoint(page, ids.photos[17]!); expect((await camera(page)).zoom).toBeCloseTo(13, 7); expect((await camera(page)).center).not.toEqual(old.center);
  await page.evaluate(ids => { for (const index of [16, 17, 18]) (document.querySelector(`#photo-list [data-photo-id="${ids.photos[index]}"]`) as HTMLButtonElement).click(); }, ids);
  await expect(page.locator('#photo-detail h3')).toContainText('海辺-19.jpg'); await visiblePoint(page, ids.photos[18]!); expect((await camera(page)).zoom).toBeCloseTo(13, 7);
  await expect(page.locator('#photo-detail .photo-summary')).toContainText('参考');
  const refCamera = await camera(page); await tile(23).click(); await expect(page.locator('#photo-detail h3')).toContainText('ランチ-24.jpg'); expect(await camera(page)).toEqual(refCamera);
  await expect(page.locator('.photo-actions').getByRole('button', { name: '地図で見る', exact: true })).toHaveCount(0);
  await tile(16).click(); await page.locator('.photo-actions').getByRole('button', { name: '地図で見る', exact: true }).click(); expect((await camera(page)).zoom).toBe(15);
  await visiblePoint(page, ids.photos[16]!); expect(await records(page)).toEqual(before);
});

test('W1 cluster members preview without expansion; only a direct cluster click zooms', async ({ page }) => {
  const ids = await seedUi(page); await probe(page); await photoList(page); const before = await records(page);
  await position(page, [129.872, 32.733], 12);
  const tile = page.locator(`#photo-list [data-photo-id="${ids.photos[16]}"]`); await tile.click();
  await expect(page.locator('#photo-detail h3')).toContainText('街並み-17.jpg'); await visiblePoint(page, ids.photos[16]!);
  expect((await camera(page)).zoom).toBe(12); await expect(page.locator('.map-spider-photo')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map.queryRenderedFeatures({ layers: ['photo-cluster-selected'] }).length)).toBeGreaterThan(0);
  const cluster = await page.evaluate(async id => {
    const map = (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map;
    const feature = map.queryRenderedFeatures({ layers: ['photo-cluster-selected'] })[0]!;
    const leaves = await (map.getSource('photos') as import('maplibre-gl').GeoJSONSource).getClusterLeaves(Number(feature.properties.cluster_id), 100, 0);
    const p = map.project((feature.geometry as GeoJSON.Point).coordinates as [number, number]);
    return { contains: leaves.some(f => f.properties?.id === id), x: p.x, y: p.y };
  }, ids.photos[16]);
  expect(cluster.contains).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map.queryRenderedFeatures({ layers: ['photo-points'] }).length)).toBe(0);
  await expect(page.locator('.map-photo-thumb')).toHaveCount(0);
  await shot(page, 'pc1440-selected-cluster');
  await page.mouse.click(cluster.x, cluster.y); await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(12);
  expect(await records(page)).toEqual(before);
});

test('W1 narrow-screen selection keeps zoom and coincident 7/12 expansion and 15-photo access survive', async ({ page }) => {
  test.setTimeout(90_000);
  const ids = await seedUi(page); await probe(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await photoList(page); await position(page, [129, 32], 11);
    await page.locator(`#photo-list [data-photo-id="${ids.photos[16]}"]`).click();
    await visiblePoint(page, ids.photos[16]!); expect((await camera(page)).zoom).toBeCloseTo(11, 7);
    await page.locator('#right-close').click();
  }
  for (const count of [7, 12, 15]) {
    const group = await seedGroup(page, count); await page.locator('#mobile-tab-map').click();
    await page.evaluate(() => { const m = (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map; m.easeTo({ center: [129.87, 32.73], zoom: 20, offset: [20 - innerWidth / 2, 180 - innerHeight / 2], duration: 0 }); });
    await expect.poll(() => page.evaluate(() => (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map.queryRenderedFeatures({ layers: ['photo-points'] }).length)).toBeGreaterThanOrEqual(count);
    await page.mouse.click(20, 180);
    if (count < 15) {
      await expect(page.locator('.map-spider-photo')).toHaveCount(count);
      for (const rect of await page.locator('.map-spider-photo').evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()))) { expect(rect.left).toBeGreaterThanOrEqual(4); expect(rect.right).toBeLessThanOrEqual(316); expect(rect.top).toBeGreaterThanOrEqual(62); expect(rect.bottom).toBeLessThan(772); }
      await page.locator(`.map-spider-photo[data-photo-id="${group.group.at(-1)}"]`).click(); await expect(page.locator('#photo-detail h3')).toContainText(`合成同一点-${String(count).padStart(3, '0')}`); await page.locator('#right-close').click();
      await page.mouse.click(20, 180); await expect(page.locator('.map-spider-photo')).toHaveCount(count); await page.mouse.click(160, 650); await expect(page.locator('.map-spider-photo')).toHaveCount(0);
    } else {
      await expect(page.locator('#map-photo-group-heading')).toHaveText('この地点の写真 15枚');
      const seen = new Set<string>();
      for (let step = 0; step < 20; step++) {
        (await page.locator('#photo-list [data-photo-id]').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.photoId!))).forEach(id => seen.add(id));
        const end = await page.locator('#left-panel').evaluate(el => { const old = el.scrollTop; el.scrollTop += el.clientHeight * .7; return old === el.scrollTop; });
        if (end) break; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      }
      expect([...seen].sort()).toEqual([...group.group].sort());
    }
    await expect(page.locator('.map-spider-paging')).toHaveCount(0);
  }
});
