import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const { trips, visits, photos, links } = await db.snapshot(); db.close(); return { trips, visits, photos, links };
  });
}
async function shot(page: Page, name: string) {
  mkdirSync('specs/ia-3-1/screenshots', { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `specs/ia-3-1/screenshots/${name}.png`, animations: 'disabled' });
}

test('IA-3.1 empty album stays compact and survives photo selection cancellation', async ({ page }) => {
  await seedUi(page); const before = await snapshot(page);
  await page.locator('#left-tab-visits').click(); await page.locator('#visit-create-from-list').click();
  await page.locator('#visit-label').fill('合成：これから集める海辺の写真'); await page.locator('#visit-save').click();
  const summary = page.locator('#visit-summary');
  await expect(summary.locator('h3')).toHaveText('合成：これから集める海辺の写真');
  await expect(summary.locator('.visit-summary-count')).toHaveText('写真 0枚');
  await expect(summary.locator('.visit-summary-cover, .empty-state, .visit-summary-captured')).toHaveCount(0);
  await expect(summary).not.toContainText('写真なし'); await expect(summary).not.toContainText('このアルバムには');
  await expect(page.locator('#visit-status')).toBeEmpty();
  await expect(page.locator('#visit-photo-editor-overlay')).toBeHidden();
  const select = summary.getByRole('button', { name: '写真を選択', exact: true });
  await expect(select).toBeVisible(); await shot(page, 'ia-3-1-pc1440-empty-album');
  const created = await snapshot(page); const album = created.visits.find(visit => visit.label === '合成：これから集める海辺の写真')!;
  expect(created.visits).toHaveLength(before.visits.length + 1); expect(created.links).toEqual(before.links);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.locator('#mobile-tab-visits').click();
    await page.locator(`#visit-list [data-visit-id="${album.id}"]`).click();
    await expect(select).toBeInViewport(); await expect(summary.getByRole('button', { name: '編集', exact: true })).toBeInViewport();
    expect((await summary.boundingBox())!.height).toBeLessThan(180);
    await shot(page, `ia-3-1-mobile${width}-empty-album`);
  }
  await select.click(); await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
  await page.locator('#vpe-list input[type=checkbox]').first().check();
  await page.locator('#vpe-cancel').click(); await page.locator('#vpe-leave-discard').click();
  await expect(summary.locator('.visit-summary-count')).toHaveText('写真 0枚');
  expect(await snapshot(page)).toEqual(created);
  await summary.getByRole('button', { name: '編集', exact: true }).click(); await expect(page.locator('#visit-label')).toHaveValue(album.label);
  await page.locator('#visit-edit-back').click(); await expect(select).toBeVisible();
  await page.locator('#right-close').click(); await expect(page.locator('body')).toHaveAttribute('data-right-open', 'false');
});

test('IA-3.1 populated album retains thumbnails dates photo viewing and limited map', async ({ page }) => {
  const ids = await seedUi(page); const before = await snapshot(page);
  const linked = before.links.filter(link => link.albumId === ids.albums[0]);
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  const summary = page.locator('#visit-summary');
  await expect(summary.locator('h3')).toHaveText('港と街の散歩');
  await expect(summary.locator('.visit-summary-count')).toHaveText(`写真 ${linked.length}枚`);
  await expect(summary.locator('.visit-summary-cover img')).toBeVisible();
  await expect(summary.locator('.visit-summary-photos img')).toHaveCount(2);
  await expect(summary.locator('.visit-summary-captured')).toHaveText('撮影 2026/01/02 〜 2026/01/04');
  await shot(page, 'ia-3-1-pc1440-populated-album');
  await summary.getByRole('button', { name: '写真を見る', exact: true }).click(); await expect(page.locator('#visit-all-photos')).toBeVisible();
  await page.locator('#visit-all-back').click(); await expect(summary).toBeVisible();
  await summary.getByRole('button', { name: '地図で見る', exact: true }).click(); await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await expect(page.locator('#visit-focus-message')).toContainText('港と街の散歩');
  await page.locator('#visit-focus-exit').click(); expect(await snapshot(page)).toEqual(before);
});
