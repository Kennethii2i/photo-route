import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
const folder = 'specs/ux-r8.1/screenshots/after';
async function record(page: Page) {
  await expect(page.locator('.map-photo-thumb').first()).toBeVisible();
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts');
    const original = PhotoMap.prototype.update;
    PhotoMap.prototype.update = function (...args) {
      original.apply(this, args);
      const state = this as unknown as { map: import('maplibre-gl').Map; photoFeatures: { id: string }[] };
      Object.assign(window, { __r8Map: state.map, __r8Source: { photos: args[0].map(photo => photo.id).sort(), points: state.photoFeatures.map(point => point.id).sort() } });
    };
  });
}
async function state(page: Page) {
  return page.evaluate(() => {
    const state = window as unknown as { __r8Map: import('maplibre-gl').Map; __r8Source: { photos: string[]; points: string[] } };
    return { ...state.__r8Source, camera: [state.__r8Map.getCenter().toArray(), state.__r8Map.getZoom()] };
  });
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const snapshot = JSON.stringify(await db.snapshot()); db.close(); return snapshot;
  });
}
async function shot(page: Page, name: string) {
  mkdirSync(folder, { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await page.locator('#left-panel').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
  const search = (await page.locator('#photo-search').boundingBox())!, filters = (await page.locator('#photo-filter-more > summary').boundingBox())!;
  expect(Math.abs(search.y - filters.y)).toBeLessThan(1);
  expect(search.x + search.width).toBeLessThan(filters.x);
  await page.screenshot({ path: `${folder}/${name}.png` });
}
async function setFour(page: Page, album: string) {
  await page.locator('#photo-search').fill('海辺');
  await page.locator('#photo-filter-more > summary').click();
  await page.locator('#photo-date-from').fill('2026-01-02');
  await expect(page.locator('#photo-filter-badge')).toHaveText('1');
  await page.locator('#photo-date-to').fill('2026-01-03');
  await expect(page.locator('#photo-filter-badge')).toHaveText('1');
  await page.locator('#photo-gps-filter').selectOption('confirmed');
  await expect(page.locator('#photo-filter-badge')).toHaveText('2');
  await page.locator('#photo-visit-filter').selectOption(`album:${album}`);
  await expect(page.locator('#photo-filter-badge')).toHaveText('3');
  await page.locator('#photo-filter-more > summary').click();
}

test('R8.1 desktop integrates condition counts and clearing without duplicating search text', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }); await record(page); const before = await records(page);
  await expect(page.locator('#photo-active-filters, #album-active-filters, .filter-chip')).toHaveCount(0);
  await expect(page.locator('#photo-filter-badge')).toBeHidden();
  await expect(page.locator('#photo-search-clear')).toBeHidden();
  await page.setViewportSize({ width: 900, height: 800 }); await page.locator('#drawer-toggle').click();
  await setFour(page, ids.albums[0]!);
  await expect(page.locator('#photo-filter-badge')).toHaveText('3');
  await expect(page.locator('#photo-filter')).not.toContainText('ファイル名：海辺');
  await expect(page.locator('#photo-filter-clear')).toBeHidden();
  await expect(page.locator('#photo-filter-more > summary')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('#photo-count')).toHaveText('1件 / 全24件');
  expect((await state(page)).photos).toEqual([ids.photos[0]]);
  expect((await state(page)).points).toEqual([ids.photos[0]]);
  await expect(page.locator('#photo-list [data-photo-id]')).toHaveCount(1);
  await shot(page, 'pc900');
  const camera = (await state(page)).camera;
  await page.locator('#photo-filter-more > summary').click();
  await expect(page.locator('#photo-visit-filter')).toHaveValue(`album:${ids.albums[0]}`);
  await expect(page.locator('#photo-filter-clear')).toBeVisible();
  await shot(page, 'pc900-filter-open');
  await page.locator('#photo-gps-filter').selectOption('all');
  await expect(page.locator('#photo-filter-badge')).toHaveText('2');
  await expect(page.locator('#photo-gps-filter')).toHaveValue('all');
  await expect(page.locator('#photo-visit-filter')).toHaveValue(`album:${ids.albums[0]}`);
  await page.locator('#photo-visit-filter').selectOption('all');
  expect((await state(page)).photos).toEqual([0, 3, 6, 9, 12, 15].map(index => ids.photos[index]!).sort());
  expect((await state(page)).points).toEqual((await state(page)).photos);
  await page.locator('#photo-date-from').fill('');
  await expect(page.locator('#photo-filter-badge')).toHaveText('1');
  await page.locator('#photo-date-clear').click();
  await expect(page.locator('#photo-date-from')).toHaveValue(''); await expect(page.locator('#photo-date-to')).toHaveValue('');
  expect((await state(page)).photos).toEqual([0, 3, 6, 9, 12, 15, 18, 21].map(index => ids.photos[index]!).sort());
  await expect(page.locator('#photo-search')).toHaveValue('海辺');
  await expect(page.locator('#photo-filter-badge')).toBeHidden();
  await page.locator('#photo-filter-more > summary').click();
  await expect(page.locator('#photo-filter-clear')).toBeHidden();
  await page.locator('#photo-search-clear').click();
  await expect(page.locator('#photo-search-clear')).toBeHidden();
  expect((await state(page)).photos).toEqual([...ids.photos].sort());
  await page.locator('#photo-search').fill('海辺');
  await page.locator('#photo-filter-more > summary').click();
  await page.locator('#photo-gps-filter').selectOption('confirmed');
  await page.locator('#photo-filter-clear').click();
  await expect(page.locator('#photo-filter-badge')).toBeHidden();
  await expect(page.locator('#photo-gps-filter')).toHaveValue('all');
  await expect(page.locator('#photo-search')).toHaveValue('');
  await expect(page.locator('#photo-search')).toBeFocused();
  expect((await state(page)).photos).toEqual([...ids.photos].sort());
  expect((await state(page)).points).toEqual(ids.photos.slice(0, 23).sort());
  expect((await state(page)).camera).toEqual(camera);
  await expect(page.locator('#trip-select')).toHaveValue(ids.trip);
  expect(await records(page)).toBe(before);
});

test('R8.1 mobile keeps the search row compact and clears independent photo and album queries', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }); await record(page);
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#mobile-tab-photos').click();
  await setFour(page, ids.albums[0]!); await shot(page, 'mobile390');
  await page.setViewportSize({ width: 320, height: 740 });
  await shot(page, 'mobile320');
  await page.locator('#photo-filter-more > summary').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#photo-visit-filter')).toBeVisible();
  await shot(page, 'mobile320-filter-open');
  await page.locator('#photo-date-clear').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#photo-date-from')).toHaveValue('');
  await expect(page.locator('#photo-date-from')).toBeFocused();
  await expect(page.locator('#photo-filter-badge')).toHaveText('2');
  await page.locator('#photo-filter-clear').click();
  await page.locator('#photo-gps-filter').selectOption('none');
  await page.locator('#photo-filter-more > summary').click();
  expect((await state(page)).photos).toEqual([ids.photos[23]]); expect((await state(page)).points).toEqual([]);
  await expect(page.locator('#photo-filter-badge')).toHaveText('1');
  await page.locator('#photo-search').fill('取り消す検索語');
  await page.locator('#photo-search-clear').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#photo-gps-filter')).toHaveValue('none');
  await expect(page.locator('#photo-search')).toBeFocused();
  await page.locator('#mobile-tab-visits').click();
  await page.locator('#album-search').fill('一致しない名前');
  await expect(page.locator('#album-active-filters, .filter-chip')).toHaveCount(0);
  await page.locator('#album-search-clear').click();
  await expect(page.locator('#album-search-clear')).toBeHidden();
  await expect(page.locator('#visit-list [data-visit-id]')).toHaveCount(3);
  await page.locator('#album-search').fill('海');
  await page.locator('#album-search-clear').click(); await expect(page.locator('#album-search')).toHaveValue('');
  await page.locator('#mobile-tab-photos').click();
  await expect(page.locator('#photo-gps-filter')).toHaveValue('none');
  await page.locator('#photo-search').fill('存在しない_長い検索語'.repeat(10));
  await expect(page.locator('#photo-list')).toContainText('検索条件に一致する写真がありません');
  await expect(page.locator('#photo-empty-clear')).toBeVisible();
  await shot(page, 'mobile320-empty-results');
  await page.locator('#photo-empty-clear').click();
  await expect(page.locator('#photo-filter-more')).toHaveAttribute('open');
  await expect(page.locator('#photo-empty-clear')).toBeHidden();
  await expect(page.locator('#photo-search')).not.toHaveValue('');
  await page.locator('#photo-filter-clear').click();
  await expect(page.locator('#photo-filter-badge')).toBeHidden();
  expect((await state(page)).photos).toHaveLength(24); expect((await state(page)).points).toHaveLength(23);
});

test('R8.1 filter clearing preserves album-only mode drafts and Trip filter integrity', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true }); await record(page); const before = await records(page);
  await page.locator('#photo-search').fill('海辺-1.jpg');
  await page.locator('#map-tools > summary').click(); await page.locator('#map-mode-visits').click(); await page.locator('#map-tools > summary').click();
  await page.locator('#left-tab-visits').click(); await page.locator('#album-search').fill('港');
  await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '地図で見る', exact: true }).click();
  const focused = await state(page);
  expect(focused.photos.length).toBeGreaterThan(1);
  await page.locator('#left-tab-photos').click(); await page.locator('#photo-filter-more > summary').click(); await page.locator('#photo-filter-clear').click();
  await expect(page.locator('#visit-focus-banner')).toContainText('港と街の散歩');
  expect(await state(page)).toEqual(focused);
  await page.locator('#photo-gps-filter').selectOption('none');
  await page.locator('#photo-filter-more > summary').click();
  await expect(page.locator('#photo-count')).toHaveText('1件 / 全24件');
  expect(await state(page)).toEqual(focused);
  await page.locator('#photo-filter-more > summary').click(); await page.locator('#photo-gps-filter').selectOption('all');
  await page.locator('#photo-filter-more > summary').click();
  expect(await state(page)).toEqual(focused);
  await expect(page.locator('#album-search')).toHaveValue('港');
  await shot(page, 'pc1440-album-mode-preserved');
  await page.locator('#visit-focus-exit').click();
  await expect(page.locator('#map-mode-visits')).toHaveAttribute('aria-pressed', 'true');
  expect((await state(page)).camera).toEqual(focused.camera);
  await page.locator('#photo-search').fill('海辺-1.jpg');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await page.locator('#photo-advanced > summary').click();
  await page.locator('#time-correction-clock').fill('2026:02:03 12:34:56');
  await page.locator('#photo-search-clear').click();
  await expect(page.locator('#time-correction-clock')).toHaveValue('2026:02:03 12:34:56');
  await expect(page.locator('#photo-correction-leave')).toBeHidden();
  expect(await records(page)).toBe(before);
  await page.locator('#right-close').click(); await page.locator('#correction-leave-discard').click();
  await page.locator('#photo-filter-more > summary').click();
  await page.locator('#photo-visit-filter').selectOption(`album:${ids.albums[0]}`);
  await page.locator('#photo-filter-more > summary').click();
  await page.locator('#trip-select').selectOption(ids.otherTrip!);
  await expect(page.locator('#photo-count')).toHaveText('0件');
  await expect(page.locator('#photo-filter-badge')).toBeHidden();
  await expect(page.locator('#photo-visit-filter')).toHaveValue('all');
  await expect(page.locator('#album-search')).toHaveValue('');
  expect((await state(page)).photos).toEqual([]);
});
