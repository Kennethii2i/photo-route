import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';
import { createTripUi, localUi } from './helpers/ux-rc-flows';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function records(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const state = { photos: await db.listPhotos(), albums: await db.listVisits(), links: await db.listPhotoAlbumLinks(), history: await db.listRecovery() };
    db.close(); return state;
  });
}
async function albums(page: Page, id: string) {
  if (page.viewportSize()!.width <= 700) {
    if (await page.locator('body').getAttribute('data-right-open') === 'true') await page.locator('#right-close').click();
    await page.locator('#mobile-tab-visits').click();
  } else {
    if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
    await page.locator('#left-tab-visits').click();
  }
  await page.locator(`#visit-list [data-visit-id="${id}"]`).click();
}
async function shot(page: Page, name: string) {
  mkdirSync('specs/ux-navigation-v2/screenshots', { recursive: true });
  if (name.includes('photos-map')) await expect.poll(() => page.locator('#photo-list').evaluate(list => {
    const area = document.getElementById('left-panel')!.getBoundingClientRect();
    const visible = [...list.querySelectorAll('button[data-photo-id]')].filter(button => { const rect = button.getBoundingClientRect(); return rect.top < area.bottom && rect.bottom > area.top; });
    return visible.length > 0 && visible.every(button => { const image = button.querySelector('img'); return image?.complete && image.naturalWidth > 0; });
  })).toBe(true);
  await page.screenshot({ path: `specs/ux-navigation-v2/screenshots/${name}.png`, animations: 'disabled' });
}
async function photos(page: Page) {
  if (page.viewportSize()!.width <= 700) await page.locator('#mobile-tab-photos').click();
  else {
    if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
    await page.locator('#left-tab-photos').click();
  }
}
async function probeMap(page: Page) {
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts');
    const original = PhotoMap.prototype.setViewportPadding;
    PhotoMap.prototype.setViewportPadding = function (padding) {
      (window as unknown as { navMap: unknown }).navMap = (this as unknown as { map: unknown }).map;
      original.call(this, padding);
    };
    window.dispatchEvent(new Event('resize'));
  });
}
async function camera(page: Page) {
  return page.evaluate(() => { const map = (window as unknown as { navMap: import('maplibre-gl').Map }).navMap;
    return { center: map.getCenter().toArray(), zoom: map.getZoom() }; });
}

test('V1 album trash confirms before writing and retains photo links and internal recovery', async ({ page }) => {
  const ids = await seedUi(page), before = await records(page);
  await albums(page, ids.albums[0]!);
  const actions = page.locator('.visit-summary-actions');
  await expect(actions.getByRole('button', { name: '編集', exact: true })).toBeVisible();
  await actions.getByRole('button', { name: 'アルバムをごみ箱へ移動', exact: true }).click();
  await expect(page.locator('#trash-confirm')).toBeVisible();
  await expect(page.locator('#trash-confirm-text')).toContainText('件は残り');
  expect(await records(page)).toEqual(before); await shot(page, 'v1-pc1440-delete-confirm');
  await page.locator('#trash-cancel').click(); expect(await records(page)).toEqual(before);
  await page.locator('#management-close').click();
  await actions.getByRole('button', { name: 'アルバムをごみ箱へ移動', exact: true }).click();
  await page.locator('#trash-commit').click();
  const deleted = await records(page);
  expect(deleted.albums.find(item => item.id === ids.albums[0])!.deletedAt).not.toBeNull();
  expect(deleted.photos).toEqual(before.photos); expect(deleted.links).toEqual(before.links);
  expect(deleted.history.length).toBe(before.history.length + 1);
  await expect(page.locator('#undo-notice, #undo-button, #vpe-undo, #pae-undo')).toHaveCount(0);
  await page.locator('#header-manage').click(); await page.locator('#trash-section > summary').click();
  await page.getByRole('button', { name: 'アルバム: 港と街の散歩を復元', exact: true }).click();
  const restored = await records(page);
  const withoutUpdate = (album: typeof restored.albums[number]) => Object.fromEntries(Object.entries(album).filter(([key]) => key !== 'updatedAt'));
  expect(restored.albums.map(withoutUpdate)).toEqual(before.albums.map(withoutUpdate));
  expect(restored.albums.find(album => album.id === ids.albums[0])!.updatedAt).not.toBe(before.albums.find(album => album.id === ids.albums[0])!.updatedAt);
  expect(restored.photos).toEqual(before.photos); expect(restored.links).toEqual(before.links);
});

test('V1 membership cancel and save preserve other albums while internal Undo stays available', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }), before = await records(page);
  await albums(page, ids.albums[0]!); await page.getByRole('button', { name: '写真を選択', exact: true }).click();
  await page.locator('#vpe-search').fill('海辺の朝_');
  const check = page.locator(`#vpe-list [data-tile-id="${ids.photos[0]}"] input`);
  await check.uncheck(); await page.locator('#vpe-cancel').click(); await expect(page.locator('#vpe-leave')).toBeVisible();
  expect(await records(page)).toEqual(before);
  await page.locator('#vpe-leave-stay').click(); await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('1枚解除');
  const saved = await records(page);
  expect(saved.links.filter(link => link.photoId === ids.photos[0]).map(link => link.albumId)).toEqual([ids.albums[1]]);
  expect(saved.photos).toEqual(before.photos); expect(saved.history.length).toBe(before.history.length + 1);
  await expect(page.locator('#vpe-undo, #pae-undo, #undo-notice')).toHaveCount(0);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const latest = await db.latestUndoable(); await db.undoLatest(latest!.id); db.close();
  });
  expect((await records(page)).links).toEqual(before.links);
});

test('V1 photo trash requires confirmation and cancellation never changes records', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }); await photos(page);
  await page.locator('#photo-search').fill('海辺の朝_'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await page.locator('#photo-advanced > summary').click();
  const before = await records(page); await page.locator('.photo-trash').click();
  await expect(page.locator('#trash-confirm')).toBeVisible(); expect(await records(page)).toEqual(before);
  await page.locator('#trash-cancel').click(); expect(await records(page)).toEqual(before);
});

test('V2 list selection moves to the right point and repeat deselect keeps camera and records', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }); await probeMap(page); await photos(page);
  await page.locator('#photo-search').fill('海辺の朝_');
  const tile = page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`);
  const before = await records(page); await tile.click();
  await expect(page.locator('#photo-detail h3')).toContainText('海辺の朝_');
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThanOrEqual(17);
  await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();
  const selectedCamera = await camera(page); await tile.click();
  await expect(page.locator('#right-panel')).toBeHidden(); await expect(page.locator('.map-photo-thumb.is-selected')).toHaveCount(0);
  expect(await camera(page)).toEqual(selectedCamera);
  await albums(page, ids.albums[0]!); await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await photos(page); await page.locator('#photo-search').fill('ランチ-24');
  const noGps = page.locator(`#photo-list [data-photo-id="${ids.photos[23]}"]`);
  const old = await camera(page); await noGps.click();
  await expect(page.locator('#visit-focus-banner')).toBeHidden();
  await expect(page.locator('#photo-search')).toHaveValue('ランチ-24');
  await expect(page.locator('#photo-detail h3')).toContainText('ランチ-24');
  expect(await camera(page)).toEqual(old); expect(await records(page)).toEqual(before);
  await shot(page, 'v2-pc1440-selection');
});

test('V2 cluster expands without a list and seven coincident photos stay reachable together', async ({ page }) => {
  test.setTimeout(45_000);
  const ids = await seedUi(page, { mobileEditing: true });
  await page.evaluate(async ids => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(), photos = await db.listPhotos();
    const raw = (db as unknown as { db: IDBDatabase }).db;
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction('photos', 'readwrite');
      const source = photos.find(item => item.id === ids[0])!.sourceGps;
      for (const id of ids.slice(0, 7)) { const photo = photos.find(item => item.id === id)!; photo.sourceGps = structuredClone(source); tx.objectStore('photos').put(photo); }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, ids.photos);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip); await probeMap(page);
  if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#drawer-toggle').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { navMap: import('maplibre-gl').Map }).navMap.queryRenderedFeatures({ layers: ['photo-clusters'] }).length)).toBeGreaterThan(0);
  const cluster = await page.evaluate(() => { const map = (window as unknown as { navMap: import('maplibre-gl').Map }).navMap;
    const f = map.queryRenderedFeatures({ layers: ['photo-clusters'] })[0]!;
    const point = map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]); return { x: point.x, y: point.y, zoom: map.getZoom() }; });
  await page.mouse.click(cluster.x, cluster.y);
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(cluster.zoom);
  await expect(page.locator('#map-photo-chooser')).toBeHidden(); await expect(page.locator('#right-panel')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (window as unknown as { navMap: import('maplibre-gl').Map }).navMap.jumpTo({ center: [129.87, 32.73], zoom: 20 }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { navMap: import('maplibre-gl').Map }).navMap.isSourceLoaded('photos'))).toBe(true);
  await expect.poll(() => page.evaluate(() => new Set((window as unknown as { navMap: import('maplibre-gl').Map }).navMap.queryRenderedFeatures({ layers: ['photo-points'] }).map(f => f.properties.id)).size)).toBeGreaterThanOrEqual(7);
  const point = await page.evaluate(() => { const p = (window as unknown as { navMap: import('maplibre-gl').Map }).navMap.project([129.87, 32.73]); return { x: p.x, y: p.y }; });
  const before = await records(page); await page.mouse.click(point.x, point.y);
  await expect(page.locator('.map-spider-photo')).toHaveCount(7);
  await expect(page.locator('#map-photo-chooser')).toBeHidden(); await shot(page, 'v2-mobile390-coincident');
  await expect(page.locator('.map-spider-paging')).toHaveCount(0);
  const last = page.locator('.map-spider-photo').last(); const name = await last.getAttribute('aria-label'); await last.click();
  await expect(page.locator('#photo-detail h3')).toHaveText(name!);
  expect(await records(page)).toEqual(before);
});

test('V2 reference coordinates move the camera with an honest reference label', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true });
  await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const photo = (await db.listPhotos()).find(item => item.id === id)!;
    photo.sourceGps = { ...photo.sourceGps, datum: null, normalized: null, status: 'suspect',
      rawTags: { GPSLatitudeRef: 'N', GPSLatitude: [[32, 1], [43, 1], [48, 1]], GPSLongitudeRef: 'E', GPSLongitude: [[129, 1], [52, 1], [12, 1]] } };
    await new Promise<void>((resolve, reject) => { const tx = (db as unknown as { db: IDBDatabase }).db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(photo); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  }, ids.photos[0]!);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip); await probeMap(page);
  await photos(page); await page.locator('#photo-search').fill('海辺の朝_'); const before = await records(page);
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThanOrEqual(17);
  await expect(page.locator('.photo-summary')).toContainText('参考位置'); expect(await records(page)).toEqual(before);
});

test('V3 photo import belongs to the photo list and keeps the chosen Trip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const ids = await seedUi(page);
  await expect(page.locator('header #header-add')).toHaveCount(0); await photos(page);
  await page.getByRole('button', { name: '写真追加', exact: true }).click();
  await expect(page.locator('#photo-import-trip')).toContainText('海辺の週末'); await shot(page, 'v3-mobile390-import');
  await page.locator('#photo-files').setInputFiles({ name: '追加する合成写真.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') });
  await page.locator('#import-button').click(); await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'done');
  const saved = await records(page); expect(saved.photos).toHaveLength(25);
  expect(saved.photos.find(photo => photo.originalFilename === '追加する合成写真.jpg')!.tripId).toBe(ids.trip);
  await page.locator('#import-done').click(); await expect(page.locator('#photo-count')).toContainText('25件');
});

test('V3 Trip management shares creation selection and confirmed trash without inventing rename', async ({ page }) => {
  await localUi(page); await page.goto('/'); await page.locator('#header-trips').click();
  await expect(page.locator('#trip-management')).toBeVisible(); await page.locator('#trip-management-create').click();
  await page.locator('#trip-name').fill('合成：北の旅行'); await page.locator('#trip-create-submit').click();
  await expect(page.locator('#trip-create-status')).toContainText('作成しました'); await page.locator('#trip-create-submit').click();
  const first = await page.locator('#trip-select').inputValue(); await createTripUi(page, '合成：南の旅行');
  await page.locator('#header-trips').click(); await expect(page.locator('#trip-management-select option')).toHaveCount(3);
  await page.locator('#trip-management-select').selectOption(first); await expect(page.locator('#trip-select')).toHaveValue(first);
  await shot(page, 'v3-pc1440-trip-management'); const before = await records(page);
  await page.locator('#trip-trash').click(); await expect(page.locator('#trip-management')).not.toBeVisible();
  await expect(page.locator('#trash-confirm')).toBeVisible(); expect(await records(page)).toEqual(before);
  await page.locator('#trash-cancel').click(); await page.locator('#management-close').click(); await page.locator('#header-trips').click();
  await page.keyboard.press('Escape'); await expect(page.locator('#trip-management')).not.toBeVisible();
  await expect(page.locator('#header-trips')).toBeFocused();
});

test('V3 album entry fits all GPS photos once and map settings retain unique controls', async ({ page }) => {
  const ids = await seedUi(page); await probeMap(page);
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts'); const original = PhotoMap.prototype.fitPhotoIds;
    PhotoMap.prototype.fitPhotoIds = function (ids) { const state = window as unknown as { fitCalls?: string[][] }; (state.fitCalls ??= []).push([...ids]); return original.call(this, ids); };
  });
  await albums(page, ids.albums[0]!); await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible(); await expect(page.locator('#visit-focus-all, #map-tools')).toHaveCount(0);
  const state = await records(page); const expected = state.links.filter(link => link.albumId === ids.albums[0]).map(link => link.photoId).sort();
  expect(await page.evaluate(() => (window as unknown as { fitCalls: string[][] }).fitCalls.map(ids => ids.sort()))).toEqual([expected]);
  await page.locator('#header-manage').click(); await page.locator('#management-extra > summary').click(); await page.locator('#management-map-settings > summary').click();
  await expect(page.locator('#map-marker-index')).toBeVisible(); await page.locator('#map-layer-custom > summary').click();
  await expect(page.locator('#photos-layer-toggle')).toBeVisible();
  await page.locator('#map-fit').click(); await expect(page.locator('#management-panel')).not.toBeVisible();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await page.locator('#visit-focus-exit').click(); await expect(page.locator('#visit-focus-banner')).toBeHidden();
});

test('V4 responsive workspace keeps controls separate and drawer Escape and blank dismissal preserve mode', async ({ page }) => {
  test.setTimeout(60_000); const ids = await seedUi(page, { mobileEditing: true }); await probeMap(page);
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (await page.locator('body').getAttribute('data-right-open') === 'true') await page.locator('#right-close').click();
    await photos(page); await page.locator('#photo-search').fill('');
    if (width === 1440 || width === 390) await shot(page, `v4-${width}-photos-map`);
    await expect(page.locator('#header-add')).toBeVisible(); await expect(page.locator('#left-close, #map-tools, #visit-focus-all, #undo-button, #undo-notice')).toHaveCount(0);
    if (width >= 900) {
      await page.locator('#photo-search').focus(); await page.keyboard.press('Escape'); await expect(page.locator('#left-panel')).toBeHidden();
      await expect(page.locator('#drawer-toggle')).toBeFocused(); await page.keyboard.press('Enter');
    }
    await page.locator('#photo-search').fill('海辺の朝_'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-right-open', 'true');
    if (width <= 390) await page.locator('#photo-detail').getByRole('button', { name: '地図で見る', exact: true }).click();
    await expect(page.locator('.photo-summary')).toContainText('GPS位置');
    await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();
    await page.locator('#right-close').click();
    await albums(page, ids.albums[0]!);
    if (width === 1440) { await shot(page, 'v4-pc1440-album-overview'); await page.getByRole('button', { name: 'アルバムをごみ箱へ移動', exact: true }).click(); await shot(page, 'v4-pc1440-delete-confirm'); await page.locator('#trash-cancel').click(); await page.locator('#management-close').click(); }
    await page.getByRole('button', { name: '地図で見る', exact: true }).click();
    await expect(page.locator('#visit-focus-banner')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const boxes = await page.evaluate(() => ['#visit-focus-banner', '#map-navigation', '#mobile-tabs', 'header'].flatMap(selector => { const el = document.querySelector<HTMLElement>(selector)!; if (!el.getClientRects().length) return []; const b=el.getBoundingClientRect(); return [{ selector, x:b.x, y:b.y, right:b.right, bottom:b.bottom }]; }));
    const banner = boxes.find(b => b.selector === '#visit-focus-banner')!, zoom = boxes.find(b => b.selector === '#map-navigation')!;
    expect(banner.x < zoom.right && banner.right > zoom.x && banner.y < zoom.bottom && banner.bottom > zoom.y).toBe(false);
    if (width === 390 || width === 320) await shot(page, `v4-mobile${width}-album-map`);
    await page.mouse.click(width > 700 ? 700 : 20, width > 700 ? 160 : 200);
    await expect(page.locator('#visit-focus-banner')).toBeVisible(); await expect(page.locator('#photo-search')).toHaveValue('海辺の朝_');
    await page.locator('#visit-focus-exit').click();
  }
});

test('V4 import progress and unseen result can be resumed while acknowledged result no longer floats', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seedUi(page); await photos(page); await page.locator('#header-add').click();
  await page.evaluate(async () => { const { PhotoImporter } = await import('../../src/application/import-photos.ts'); const original = PhotoImporter.prototype.importFiles;
    PhotoImporter.prototype.importFiles = async function (...args) { await new Promise<void>(resolve => { (window as unknown as { releaseImport: () => void }).releaseImport = resolve; }); return original.apply(this, args); }; });
  await page.locator('#photo-files').setInputFiles({ name: '合成結果.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') });
  await page.locator('#import-button').click(); await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'running');
  await page.locator('#import-close').click(); await expect(page.locator('#import-task')).toBeVisible();
  await page.locator('#import-task').click(); await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'running');
  await page.locator('#import-close').click(); await page.evaluate(() => (window as unknown as { releaseImport: () => void }).releaseImport());
  await expect(page.locator('#import-task')).toContainText('結果を見る');
  await page.locator('#import-task').click(); await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'done');
  await page.locator('#import-done').click(); await expect(page.locator('#import-task')).toBeHidden();
  expect((await records(page)).photos).toHaveLength(25);
});

test('V4 unsaved correction and unknown membership save remain protected through new navigation', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true });
  await albums(page, ids.albums[0]!); await page.getByRole('button', { name: '写真を見る', exact: true }).click();
  await expect(page.locator('#visit-all-photos')).toBeVisible(); const scroll = await page.locator('#right-panel').evaluate(el => el.scrollTop);
  await page.locator(`#visit-all-photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.getByRole('button', { name: 'アルバムへ戻る', exact: true }).click();
  await expect(page.locator('#visit-all-photos')).toBeVisible();
  await expect.poll(() => page.locator('#right-panel').evaluate(el => el.scrollTop)).toBe(scroll);
  await photos(page); await page.locator('#photo-search').fill('海辺の朝_');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click(); await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await page.locator('#photo-advanced > summary').click(); await page.locator('#gps-correction-latitude').fill('35.1');
  const before = await records(page); await page.locator('#header-trips').click(); await expect(page.locator('#photo-correction-leave')).toBeVisible();
  await expect(page.locator('#trip-management')).not.toBeVisible(); await page.locator('#correction-leave-stay').click();
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('35.1'); expect(await records(page)).toEqual(before);
  await page.locator('#right-close').click(); await page.locator('#correction-leave-discard').click();
  await albums(page, ids.albums[0]!); await page.getByRole('button', { name: '写真を選択', exact: true }).click(); await page.locator('#vpe-search').fill('海辺の朝_');
  await page.locator(`#vpe-list [data-tile-id="${ids.photos[0]}"] input`).uncheck();
  await page.evaluate(async () => { const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); LibraryDb.prototype.saveAlbumMembershipBatch = async () => { throw new Error('synthetic response loss'); }; LibraryDb.prototype.albumMembershipOperationStatus = async () => 'unknown'; });
  await page.locator('#vpe-save').click(); await expect(page.locator('#vpe-conflict')).toBeVisible(); await page.locator('#vpe-conflict-close').click();
  await page.locator('#vpe-close').click(); await expect(page.locator('#vpe-conflict')).toBeVisible(); await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
  expect(await records(page)).toEqual(before);
});
