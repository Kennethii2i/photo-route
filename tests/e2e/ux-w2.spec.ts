import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';
import { records } from './helpers/coincident-photos';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function photoList(page: Page) {
  if (page.viewportSize()!.width <= 700) await page.locator('#mobile-tab-photos').click();
  else { if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click(); await page.locator('#left-tab-photos').click(); }
}
async function shot(page: Page, name: string) {
  mkdirSync('specs/ux-w2/screenshots', { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `specs/ux-w2/screenshots/${name}.png`, animations: 'disabled' });
}
async function toolbar(page: Page) {
  await expect(page.locator('#header-add')).toBeVisible();
  const geometry = await page.locator('#header-add').evaluate(button => {
    const r = button.getBoundingClientRect(), header = document.querySelector('#left-panel > .panel-top')!.getBoundingClientRect(), count = document.getElementById('photo-count')!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, countRight: count.right, countY: count.y, countBottom: count.bottom, headerBottom: header.bottom,
      hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
  });
  expect(geometry.width).toBe(44); expect(geometry.height).toBe(44); expect(geometry.y).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
  expect(geometry.countRight).toBeLessThan(geometry.x); expect(geometry.countY).toBeLessThan(geometry.y + geometry.height); expect(geometry.countBottom).toBeGreaterThan(geometry.y); expect(geometry.hit).toBe(true);
}
async function actions(page: Page) {
  const map = page.locator('.photo-actions').getByRole('button', { name: '地図で見る', exact: true });
  const trash = page.locator('.photo-actions').getByRole('button', { name: '写真をごみ箱へ移動', exact: true });
  await expect(map).toBeVisible(); await expect(trash).toBeVisible();
  expect(await map.evaluate(button => button.nextElementSibling?.classList.contains('photo-trash'))).toBe(true);
  await expect(page.locator('#photo-advanced .photo-trash')).toHaveCount(0); await expect(page.locator('.photo-trash')).toHaveCount(1);
  for (const button of [map, trash]) expect(await button.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
  return trash;
}

test('W2 desktop photo and album actions share a compact row and stay operable while scrolling', async ({ page }) => {
  await seedUi(page); await photoList(page); const before = await records(page);
  await toolbar(page); await shot(page, 'pc1440-photo-list');
  await page.locator('#left-panel').evaluate(el => { el.scrollTop = 700; });
  await toolbar(page); await page.locator('#header-add').click();
  await expect(page.locator('#photo-import-dialog')).toBeVisible(); await expect(page.locator('#photo-import-trip')).toContainText('海辺の週末');
  await expect(page.locator('#import-button')).toBeDisabled(); await page.locator('#import-close').click();
  await page.locator('#left-tab-visits').click();
  await expect(page.locator('.album-list-heading #visit-create-from-list')).toBeVisible();
  await page.locator('#visit-create-from-list').click(); await expect(page.locator('#visit-form')).toBeVisible(); await page.locator('#visit-edit-back').click();
  expect(await records(page)).toEqual(before);
});

test('W2 photo trash is beside map; confirmation cancellation and unsaved correction protection retain records', async ({ page }) => {
  const ids = await seedUi(page); await photoList(page); const before = await records(page);
  await page.locator(`#photo-list [data-photo-id="${ids.photos[16]}"]`).click(); await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  const trash = await actions(page); await shot(page, 'pc1440-photo-detail');
  await trash.click(); await expect(page.locator('#trash-confirm')).toBeVisible(); await expect(page.locator('#trash-confirm-text')).toContainText('写真本体「街並み-17.jpg」');
  expect(await records(page)).toEqual(before); await page.locator('#trash-cancel').click(); await page.locator('#management-close').click(); expect(await records(page)).toEqual(before);
  await page.locator('#photo-advanced > summary').click(); await page.locator('#gps-correction-latitude').fill('34.123');
  await trash.click(); await expect(page.locator('#photo-correction-leave')).toBeVisible(); await expect(page.locator('#management-panel')).not.toBeVisible();
  await page.locator('#correction-leave-stay').click(); await expect(page.locator('#gps-correction-latitude')).toHaveValue('34.123');
  await trash.click(); await page.locator('#correction-leave-keep').click(); await expect(page.locator('#trash-confirm')).toBeVisible();
  expect(await records(page)).toEqual(before); await page.locator('#trash-cancel').click(); await page.locator('#management-close').click();
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('34.123'); expect(await records(page)).toEqual(before);
});

test('W2 mobile 390 and 320 keep add and photo actions tappable without overflow', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true }); const before = await records(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await photoList(page);
    await page.locator('#photo-search').fill(''); await page.locator('#left-panel').evaluate(el => { el.scrollTop = 0; });
    await toolbar(page); await shot(page, `${width}-photo-list`);
    await page.locator('#left-panel').evaluate(el => { el.scrollTop = 700; }); await toolbar(page);
    await page.locator('#header-add').click(); await expect(page.locator('#photo-import-dialog')).toBeVisible(); await page.locator('#import-close').click();
    await page.locator('#photo-search').fill('海辺の朝_'); await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
    await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
    const trash = await actions(page); await shot(page, `${width}-photo-detail`);
    await trash.focus(); await page.keyboard.press('Enter'); await expect(page.locator('#trash-confirm')).toBeVisible();
    await page.locator('#trash-cancel').click(); await page.locator('#management-close').click(); await page.locator('#right-close').click();
  }
  expect(await records(page)).toEqual(before);
});
