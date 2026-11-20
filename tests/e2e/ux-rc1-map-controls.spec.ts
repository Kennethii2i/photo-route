import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';
import { localUi, photoListUi } from './helpers/ux-rc-flows';

test.use({ actionTimeout: 7000 });
const folder = `specs/ux-rc1/screenshots/${process.env.PHOTO_ROUTE_SCREENSHOT_STAGE === 'before' ? 'before' : 'after'}`;

async function seedControls(page: Page) {
  const ids = await seedUi(page, { mobileEditing: true });
  await localUi(page); await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  await expect(page.locator('#photo-count')).toContainText('24件'); return ids;
}

async function albumMap(page: Page, albumId: string) {
  const mobile = page.viewportSize()!.width <= 700;
  if (await page.locator('body').getAttribute('data-right-open') === 'true') await page.locator('#right-close').click();
  if (mobile) await page.locator('#mobile-tab-visits').click();
  else {
    if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
    await page.locator('#left-tab-visits').click();
  }
  await page.locator(`#visit-list [data-visit-id="${albumId}"]`).click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await expect(page.locator('#right-panel')).toBeHidden();
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    };
    const issues: string[] = [], banner = rect('#visit-focus-banner'), nav = rect('#map-navigation');
    const obstacles = ['.maplibregl-ctrl-attrib', '#mobile-tabs', '#right-panel', '#map-tools', 'header'];
    const overlaps = (a: NonNullable<ReturnType<typeof rect>>, b: NonNullable<ReturnType<typeof rect>>) =>
      a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
    if (banner && nav && overlaps(banner, nav)) issues.push('album bar / zoom');
    for (const selector of obstacles) {
      const b = rect(selector); if (!b) continue;
      if (banner && overlaps(banner, b)) issues.push(`album bar / ${selector}`);
      if (nav && overlaps(nav, b)) issues.push(`zoom / ${selector}`);
    }
    const attribution = rect('.maplibregl-ctrl-attrib');
    for (const selector of ['#mobile-tabs', '#right-panel']) {
      const b = rect(selector); if (attribution && b && overlaps(attribution, b)) issues.push(`attribution / ${selector}`);
    }
    for (const selector of ['#visit-focus-exit', '#visit-focus-all', '#map-zoom-in', '#map-zoom-out']) {
      const el = document.querySelector<HTMLElement>(selector)!, b = rect(selector)!;
      if (b.width < 44 || b.height < 44) issues.push(`small tap area: ${selector}`);
      if (b.x < 0 || b.y < 0 || b.right > innerWidth || b.bottom > innerHeight) issues.push(`offscreen: ${selector}`);
      if (!el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))) issues.push(`covered: ${selector}`);
    }
    if (document.documentElement.scrollWidth > innerWidth) issues.push('horizontal overflow');
    return { issues, banner, nav, attribution };
  });
}

test('UX-RC.1 layout keeps map controls reachable across panels attribution and short viewports', async ({ page }) => {
  test.setTimeout(60_000);
  const ids = await seedControls(page), results = [];
  for (const [width, height] of [[1440, 900], [900, 700], [390, 844], [320, 740], [390, 480], [320, 480], [900, 480]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await albumMap(page, ids.albums[0]!);
    for (const preview of [false, true]) {
      if (preview) {
        await photoListUi(page); await page.locator('#photo-search').fill('海辺の朝_');
        await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
        await page.locator('#photo-detail').getByRole('button', { name: '地図で見る', exact: true }).click();
        await expect.poll(() => page.locator('#right-panel').evaluate(el => getComputedStyle(el).transform)).toBe('none');
      }
      const attributionButton = page.locator('.maplibregl-ctrl-attrib-button');
      if (await attributionButton.isVisible() && !await page.locator('.maplibregl-ctrl-attrib').evaluate(el => el.classList.contains('maplibregl-compact-show'))) await attributionButton.click();
      await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
      // The existing ResizeObservers publish the measured attribution/preview heights.
      await expect.poll(() => page.locator('body').evaluate(el => el.style.getPropertyValue('--map-attribution-height'))).not.toBe('');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const result = await geometry(page); results.push({ width, height, preview, ...result });
      if (height! > 700 && width! <= 390 || preview && (width! >= 900 || height === 480 && width === 320)) {
        mkdirSync(folder, { recursive: true });
        await page.screenshot({ path: `${folder}/${width}x${height}-${preview ? 'preview' : 'album'}.png`, animations: 'disabled' });
      }
    }
  }
  expect(results.filter(result => result.issues.length)).toEqual([]);
});

test('UX-RC.1 fit zoom and exit remain distinct and preserve saved records', async ({ page }) => {
  test.setTimeout(40_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const ids = await seedControls(page);
  const before = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const value = { photos: await db.listPhotos(), links: await db.listPhotoAlbumLinks() }; db.close(); return value;
  });
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts'); const original = PhotoMap.prototype.fitPhotoIds;
    PhotoMap.prototype.fitPhotoIds = function (ids) {
      const state = window as unknown as { fitCalls?: string[][]; rcMap?: unknown };
      (state.fitCalls ??= []).push([...ids]); state.rcMap = (this as unknown as { map: unknown }).map;
      return original.call(this, ids);
    };
  });
  await albumMap(page, ids.albums[0]!);
  const expected = before.links.filter(link => link.albumId === ids.albums[0]).map(link => link.photoId).sort();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
    const calls = await page.evaluate(() => (window as unknown as { fitCalls: string[][] }).fitCalls.length);
    await page.locator('#visit-focus-all').click();
    expect(await page.evaluate(() => (window as unknown as { fitCalls: string[][] }).fitCalls.length)).toBe(calls + 1);
    expect(await page.evaluate(() => (window as unknown as { fitCalls: string[][] }).fitCalls.at(-1)!.sort())).toEqual(expected);
    await expect(page.locator('#visit-focus-banner')).toBeVisible();
    const zoom = () => page.evaluate(() => (window as unknown as { rcMap: import('maplibre-gl').Map }).rcMap.getZoom());
    const previous = await zoom(); await page.locator('#map-zoom-in').click(); await expect.poll(zoom).toBeGreaterThan(previous + .5);
    const enlarged = await zoom(); await page.locator('#map-zoom-out').click(); await expect.poll(zoom).toBeLessThan(enlarged - .5);
    const photoIds = await page.evaluate(async () => {
      const map = (window as unknown as { rcMap: import('maplibre-gl').Map }).rcMap;
      const data = await (map.getSource('photos') as import('maplibre-gl').GeoJSONSource).getData() as import('geojson').FeatureCollection;
      return data.features.map(feature => String(feature.id)).sort();
    });
    expect(photoIds).toEqual(expected);
    if (width === 390) await page.locator('#visit-focus-exit').click();
    else { await page.locator('#visit-focus-exit').focus(); await page.keyboard.press('Enter'); }
    await expect(page.locator('#visit-focus-banner')).toBeHidden();
    if (width === 390) await albumMap(page, ids.albums[0]!);
  }
  const after = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const value = { photos: await db.listPhotos(), links: await db.listPhotoAlbumLinks() }; db.close(); return value;
  });
  expect(after).toEqual(before);
});
