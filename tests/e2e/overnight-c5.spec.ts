import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

const folder = 'specs/overnight-2026-11-20/c5';
test.beforeEach(() => { mkdirSync(folder, { recursive: true }); });
async function recordMap(page: Page) {
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts');
    const original = PhotoMap.prototype.update;
    PhotoMap.prototype.update = function (...args) {
      original.apply(this, args);
      const pointIds = (this as unknown as { photoFeatures: { id: string }[] }).photoFeatures.map(point => point.id);
      Object.assign(window, { __searchMap: { photos: args[0].map(photo => photo.id), points: pointIds, visits: args[1].map(visit => visit.id) } });
    };
  });
}
async function mapIds(page: Page) {
  return page.evaluate(() => (window as unknown as { __searchMap: { photos: string[]; points: string[]; visits: string[] } }).__searchMap);
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    try { return JSON.stringify(await db.snapshot()); } finally { db.close(); }
  });
}
test('album name search stays within the Trip and does not mutate records or ordering', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true }); const before = await records(page);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(200);
    if (width < 700) await page.locator('#mobile-tab-visits').click(); else await page.locator('#left-tab-visits').click();
    const order = await page.locator('#visit-list button').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.visitId));
    expect(order).toHaveLength(4);
    await page.locator('#album-search').fill('港と街'); await expect(page.locator('#visit-list button')).toHaveCount(2);
    expect(await page.locator('#visit-list button').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.visitId))).toEqual(order.filter(id => id === ids.albums[0] || id === ids.albums[3]));
    await page.locator('#album-search').fill('見つからない'); await expect(page.locator('#visit-list')).toContainText('一致するアルバムがありません');
    await page.locator('#album-search').fill(''); await expect(page.locator('#visit-list button')).toHaveCount(4);
    expect(await page.locator('#visit-list button').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.visitId))).toEqual(order);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  expect(await records(page)).toBe(before);
});
test('photo album filter combines name day and GPS and keeps map input deduplicated', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true }); await recordMap(page);
  const before = await records(page);
  await page.locator('#photo-filter-more > summary').click();
  await page.locator('#photo-visit-filter').selectOption(`album:${ids.albums[0]}`);
  await expect(page.locator('#photo-count')).toContainText('12件');
  await expect.poll(async () => (await mapIds(page))?.photos.length).toBe(12);
  await page.locator('#photo-visit-filter').selectOption(`album:${ids.albums[3]}`);
  await expect(page.locator('#photo-count')).toContainText('1件');
  expect((await mapIds(page)).photos).toEqual([ids.photos[0]]); expect((await mapIds(page)).points).toEqual([ids.photos[0]]);
  const names = await page.locator('#photo-visit-filter option').allTextContents();
  expect(names.filter(name => name.startsWith('港と街の散歩'))).toHaveLength(2);
  expect(new Set(names.filter(name => name.startsWith('港と街の散歩'))).size).toBe(2);
  await page.locator('#photo-gps-filter').selectOption('none'); await expect(page.locator('#photo-count')).toContainText('0件');
  await page.locator('#photo-gps-filter').selectOption('all'); await page.locator('#photo-visit-filter').selectOption('unlinked');
  await expect(page.locator('#photo-count')).toContainText('1件'); expect((await mapIds(page)).photos).toEqual([ids.photos[23]]); expect((await mapIds(page)).points).toEqual([]);
  await page.locator('#photo-visit-filter').selectOption(`album:${ids.albums[0]}`); await page.locator('#photo-search').fill('海辺');
  await page.locator('#photo-date-from').fill('2026-01-02'); await page.locator('#photo-date-to').fill('2026-01-02');
  await expect(page.locator('#photo-count')).toContainText('3件');
  expect(new Set((await mapIds(page)).photos).size).toBe(3);
  await page.locator('#left-tab-visits').click(); await expect(page.locator('#visit-list button')).toHaveCount(4);
  expect(await records(page)).toBe(before);
});
test('album map focus restores normal filters and Trip switch clears stale album ID', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true }); await recordMap(page);
  await page.locator('#photo-filter-more > summary').click(); await page.locator('#photo-visit-filter').selectOption(`album:${ids.albums[3]}`);
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[1]}"]`).click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  expect((await mapIds(page)).photos).not.toContain(ids.photos[0]); expect((await mapIds(page)).photos.length).toBeGreaterThan(1);
  await page.locator('#visit-focus-exit').click(); expect((await mapIds(page)).photos).toEqual([ids.photos[0]]);
  await page.locator('#left-tab-photos').click(); await expect(page.locator('#photo-visit-filter')).toHaveValue(`album:${ids.albums[3]}`);
  await page.locator('#trip-select').selectOption(ids.otherTrip!);
  await expect(page.locator('#photo-visit-filter')).toHaveValue('all'); await expect(page.locator('#photo-count')).toContainText('0件');
  expect(await page.locator('#photo-visit-filter option').allTextContents()).toContain('別旅行のアルバム');
  expect(await page.locator('#photo-visit-filter option').allTextContents()).not.toContain('海のある風景');
});
