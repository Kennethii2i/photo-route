import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function records(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const state = { photos: await db.listPhotos(), albums: await db.listVisits(), trips: await db.listTrips(), links: await db.listPhotoAlbumLinks(), history: await db.listRecovery() };
    db.close(); return state;
  });
}
async function probe(page: Page) {
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts'); const original = PhotoMap.prototype.setViewportPadding;
    PhotoMap.prototype.setViewportPadding = function (padding) { (window as unknown as { v41Map: unknown }).v41Map = (this as unknown as { map: unknown }).map; original.call(this, padding); };
    window.dispatchEvent(new Event('resize'));
  });
}
async function camera(page: Page) {
  return page.evaluate(() => { const map = (window as unknown as { v41Map: import('maplibre-gl').Map }).v41Map; return { center: map.getCenter().toArray(), zoom: map.getZoom() }; });
}
async function seedGroup(page: Page, count: number) {
  const ids = await seedUi(page, { mobileEditing: true });
  const group = await page.evaluate(async ({ ids, count }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const { photoSchema } = await import('../../src/domain/model');
    const db = await LibraryDb.open(), photos = await db.listPhotos(), source = photos.find(p => p.id === ids.photos[0])!;
    const group: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const tx = (db as unknown as { db: IDBDatabase }).db.transaction(['photos', 'photoAlbumLinks'], 'readwrite');
      for (let i = 0; i < count; i++) {
        const photo = i < ids.photos.length ? photos.find(p => p.id === ids.photos[i])! : photoSchema.parse({ ...source, id: crypto.randomUUID(), thumbnailId: null, thumbnailState: 'not-attempted', contentSha256: (1000 + i).toString(16).padStart(64, '0') });
        photo.sourceGps = structuredClone(source.sourceGps); photo.originalFilename = `合成同一点-${String(i + 1).padStart(3, '0')}.jpg`;
        tx.objectStore('photos').put(photo); tx.objectStore('photoAlbumLinks').put({ albumId: ids.albums[0]!, photoId: photo.id, createdAt: null }); group.push(photo.id);
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close(); return group;
  }, { ids, count });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip); await probe(page);
  return { ...ids, group };
}
async function photos(page: Page) {
  if (page.viewportSize()!.width <= 700) await page.locator('#mobile-tab-photos').click();
  else { if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click(); await page.locator('#left-tab-photos').click(); }
}
async function album(page: Page, id: string) {
  if (await page.locator('body').getAttribute('data-right-open') === 'true') await page.locator('#right-close').click();
  if (page.viewportSize()!.width <= 700) await page.locator('#mobile-tab-visits').click();
  else { if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click(); await page.locator('#left-tab-visits').click(); }
  await page.locator(`#visit-list [data-visit-id="${id}"]`).click();
}
async function point(page: Page, count: number, edge = false) {
  const width = page.viewportSize()!.width, height = page.viewportSize()!.height;
  await page.evaluate(({ x, y, width, height }) => {
    const map = (window as unknown as { v41Map: import('maplibre-gl').Map }).v41Map;
    map.easeTo({ center: [129.87, 32.73], zoom: 20, offset: [x - width / 2, y - height / 2], duration: 0 });
  }, { x: edge ? 20 : width / 2, y: edge ? 92 : height / 2, width, height });
  await expect.poll(() => page.evaluate(() => new Set((window as unknown as { v41Map: import('maplibre-gl').Map }).v41Map.queryRenderedFeatures({ layers: ['photo-points'] }).map(f => f.properties.id)).size)).toBeGreaterThanOrEqual(count);
  return page.evaluate(() => { const p = (window as unknown as { v41Map: import('maplibre-gl').Map }).v41Map.project([129.87, 32.73]); return { x: p.x, y: p.y }; });
}
async function shot(page: Page, name: string) {
  mkdirSync('specs/ux-v4-1/screenshots', { recursive: true });
  await page.screenshot({ path: `specs/ux-v4-1/screenshots/${name}.png`, animations: 'disabled' });
}
async function noUndo(page: Page) {
  await expect(page.getByRole('button', { name: /Undo|元に戻す|取り消す|操作履歴/i, includeHidden: true })).toHaveCount(0);
  await expect(page.locator('#undo-button, #undo-notice, #undo-group, #vpe-undo, #pae-undo')).toHaveCount(0);
}

test('V4.1 seven and twelve photos expand together inside the visible map without camera movement', async ({ page }) => {
  test.setTimeout(60_000);
  for (const count of [7, 12]) {
    const ids = await seedGroup(page, count), before = await records(page);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (width > 700 && await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#drawer-toggle').click();
      if (width <= 700) await page.locator('#mobile-tab-map').click();
      const location = await point(page, count, true), initialCamera = await camera(page);
      await page.mouse.click(location.x, location.y);
      await expect(page.locator('.map-spider-photo')).toHaveCount(count); await expect(page.locator('.map-spider-paging')).toHaveCount(0);
      expect(await camera(page)).toEqual(initialCamera);
      const targets = await page.locator('.map-spider-photo').evaluateAll(buttons => buttons.map(button => {
        const rect = button.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, hit: button.contains(hit) };
      }));
      for (const target of targets) { expect(target.hit).toBe(true); expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); expect(target.x).toBeGreaterThanOrEqual(0); expect(target.right).toBeLessThanOrEqual(width); expect(target.y).toBeGreaterThanOrEqual(58); expect(target.bottom).toBeLessThan(772); }
      // Circular buttons can have intersecting bounding-box corners without overlapping targets.
      for (let a = 0; a < targets.length; a++) for (let b = a + 1; b < targets.length; b++) expect(Math.hypot(targets[a]!.x - targets[b]!.x, targets[a]!.y - targets[b]!.y)).toBeGreaterThanOrEqual(52);
      if (count === 7 || width === 390) await shot(page, `cluster-${count}-${width}`);
      await page.mouse.click(width - 85, 660); await expect(page.locator('.map-spider-photo')).toHaveCount(0); expect(await camera(page)).toEqual(initialCamera);
      await page.mouse.click(location.x, location.y); await expect(page.locator('.map-spider-photo')).toHaveCount(count);
      const target = page.locator(`.map-spider-photo[data-photo-id="${ids.group.at(-1)}"]`); const label = await target.getAttribute('aria-label'); await target.click();
      await expect(page.locator('#photo-detail h3')).toHaveText(label!);
      expect(await records(page)).toEqual(before); await page.locator('#right-close').click();
    }
  }
});

test('V4.1 fifteen and many coincident photos use the existing virtual list and retain search and album mode', async ({ page }) => {
  test.setTimeout(60_000);
  for (const count of [15, 120]) {
    const ids = await seedGroup(page, count), before = await records(page);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await photos(page); await page.locator('#photo-search').fill('元の条件（検索0件）');
      await album(page, ids.albums[0]!); await page.getByRole('button', { name: '地図で見る', exact: true }).click();
      const location = await point(page, count), initialCamera = await camera(page);
      await page.mouse.click(location.x, location.y);
      await expect(page.locator('#map-photo-group-heading')).toHaveText(`この地点の写真 ${count}枚`);
      await expect(page.locator('.map-spider-paging, .map-spider-photo')).toHaveCount(0);
      await expect(page.locator('#visit-focus-banner')).toBeVisible(); expect(await camera(page)).toEqual(initialCamera);
      const seen = new Set<string>(); let maxDom = 0;
      for (let step = 0; step < 100; step++) {
        const visible = await page.locator('#photo-list [data-photo-id]').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.photoId!));
        visible.forEach(id => seen.add(id)); maxDom = Math.max(maxDom, visible.length);
        const done = await page.locator('#left-panel').evaluate(el => { const old = el.scrollTop; el.scrollTop += el.clientHeight * .7; return old === el.scrollTop; });
        if (done) break; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      expect([...seen].sort()).toEqual([...ids.group].sort()); expect(maxDom).toBeLessThan(60);
      await expect(page.locator('#map-photo-group-back')).toBeInViewport();
      expect(await page.locator('#map-photo-group-back').evaluate(button => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
      if (count === 15) await shot(page, `list-15-${width}`);
      const last = page.locator('#photo-list [data-photo-id]').last(); const name = await last.getAttribute('aria-label'); await last.click();
      await expect(page.locator('#photo-detail h3')).toHaveText(name!); await page.locator('#right-close').click();
      await page.locator('#map-photo-group-back').click(); await expect(page.locator('#photo-search')).toHaveValue('元の条件（検索0件）');
      await expect(page.locator('#visit-focus-banner')).toBeVisible(); expect(await records(page)).toEqual(before);
    }
  }
});

test('V4.1 no reachable or hidden Undo controls remain after viewing editing saving or keyboard actions', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }); await noUndo(page); await album(page, ids.albums[0]!); await noUndo(page);
  await page.getByRole('button', { name: '編集', exact: true }).click(); await noUndo(page); await page.locator('#visit-edit-back').click();
  await page.getByRole('button', { name: '写真を選択', exact: true }).click(); await page.locator('#vpe-search').fill('海辺の朝_'); await noUndo(page);
  await page.locator(`#vpe-list [data-tile-id="${ids.photos[0]}"] input`).uncheck(); await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('1枚解除'); await noUndo(page); await page.locator('#vpe-close').click();
  await photos(page); await page.locator('#photo-search').fill('海辺の朝_'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await noUndo(page); await page.locator('#photo-album-edit-open').click();
  await page.locator(`#pae-list [data-album-id="${ids.albums[2]}"] input`).check(); await page.locator('#pae-save').click();
  await expect(page.locator('#pae-status')).toContainText('1件追加'); await noUndo(page); const saved = await records(page);
  await page.locator('#pae-close').focus(); await page.keyboard.press('Control+z'); await page.keyboard.press('Meta+z'); expect(await records(page)).toEqual(saved);
  await page.locator('#pae-close').click(); await page.locator('#right-close').click();
  await page.locator('#header-manage').click(); await noUndo(page); await shot(page, 'management-no-undo'); await page.locator('#management-close').click();
  await page.locator('#header-trips').click(); await noUndo(page);
});

test('V4.1 all three trash actions confirm first and internal guarded Undo and trash restore remain intact', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true });
  for (const kind of ['photo', 'visit', 'trip'] as const) {
    if (kind === 'photo') { await photos(page); await page.locator('#photo-search').fill('海辺の朝_'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click(); await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await page.locator('#photo-advanced > summary').click(); }
    if (kind === 'visit') await album(page, ids.albums[0]!);
    if (kind === 'trip') await page.locator('#header-trips').click();
    const before = await records(page);
    const stage = async () => { if (kind === 'photo') await page.locator('.photo-trash').click(); else if (kind === 'visit') await page.getByRole('button', { name: 'アルバムをごみ箱へ移動', exact: true }).click(); else await page.locator('#trip-trash').click(); };
    await stage(); await expect(page.locator('#trash-confirm')).toBeVisible(); expect(await records(page)).toEqual(before);
    if (kind === 'visit') await expect(page.locator('#trash-confirm-text')).toContainText('件は残り');
    await page.locator('#trash-cancel').click(); expect(await records(page)).toEqual(before); await page.locator('#management-close').click();
    if (kind === 'trip') await page.locator('#header-trips').click();
    await stage(); await page.locator('#trash-commit').click();
    await expect.poll(async () => (await records(page)).history.length).toBe(before.history.length + 1); await noUndo(page);
    const deleted = await records(page);
    await page.evaluate(async () => {
      const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
      try { await db.undoLatest('wrong-operation-id'); throw new Error('guard failed'); } catch (error) { if ((error as Error).message === 'guard failed') throw error; } finally { db.close(); }
    });
    expect(await records(page)).toEqual(deleted);
    await page.evaluate(async () => { const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const latest = await db.latestUndoable(); await db.undoLatest(latest!.id); db.close(); });
    const restored = await records(page); expect(restored.photos).toEqual(before.photos); expect(restored.albums).toEqual(before.albums); expect(restored.trips).toEqual(before.trips); expect(restored.links).toEqual(before.links);
    await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  }
  const beforeRestore = await records(page);
  await page.locator('#header-trips').click(); await page.locator('#trip-trash').click(); await page.locator('#trash-commit').click();
  await expect(page.locator('#trash-section')).toBeVisible(); if (!await page.locator('#trash-section').evaluate(el => (el as HTMLDetailsElement).open)) await page.locator('#trash-section > summary').click();
  await page.getByRole('button', { name: '旅行: 海辺の週末を復元', exact: true }).click();
  await expect.poll(async () => (await records(page)).trips.find(trip => trip.id === ids.trip)!.deletedAt).toBeNull();
  expect((await records(page)).links).toEqual(beforeRestore.links); expect((await records(page)).photos).toEqual(beforeRestore.photos); await noUndo(page);
});
