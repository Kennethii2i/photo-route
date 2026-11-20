import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('P1 archive exports locally, restores in a fresh browser, skips identical, refuses conflict and invalid ZIP', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5184/') && !request.url().startsWith('blob:http://127.0.0.1:5184/')) external.push(request.url()); });
  await page.goto('/');
  await page.locator('#header-manage').click();
  await page.getByLabel('新しい旅行名').fill('持ち運ぶ旅行');
  await page.getByRole('button', { name: '旅行を作成' }).click();
  await page.locator('#manage-import').click();
  await page.locator('#photo-files').setInputFiles({ name: 'gps.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') });
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#manage-archive').click();
  await page.getByRole('button', { name: 'ZIPを書き出す' }).click();
  const download = await downloadPromise;
  const archive = readFileSync(await download.path());
  expect(download.suggestedFilename()).toMatch(/^photo-route-.*\.zip$/);
  expect(archive.length).toBeGreaterThan(100);
  expect(external).toEqual([]);

  const fresh = await browser.newContext();
  const target = await fresh.newPage();
  await target.goto('/');
  await target.locator('#header-manage').click();
  await target.locator('#archive-file').setInputFiles({ name: 'transfer.zip', mimeType: 'application/zip', buffer: archive });
  await target.getByRole('button', { name: '検証して復元' }).click();
  await expect(target.locator('#archive-status')).toContainText('1件の旅行と1件の写真を復元');
  await target.locator('#trip-select').selectOption({ label: '持ち運ぶ旅行' });
  await expect(target.locator('#photo-list button')).toHaveCount(1);
  await target.locator('#management-close').click();
  await target.locator('#photo-list button').click();
  await target.locator('#header-manage').click();
  await target.locator('#manage-archive').click();
  await expect(target.locator('#photo-detail img')).toBeVisible();
  await target.getByRole('button', { name: '検証して復元' }).click();
  await expect(target.locator('#archive-status')).toContainText('同一内容のため復元をスキップ');
  await target.locator('#archive-file').setInputFiles({ name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from([1, 2, 3]) });
  await target.getByRole('button', { name: '検証して復元' }).click();
  await expect(target.locator('#archive-status')).toContainText('復元を拒否');
  await expect(target.locator('#photo-list button')).toHaveCount(1);
  await fresh.close();

  const conflicting = await browser.newContext();
  const conflictPage = await conflicting.newPage();
  await conflictPage.goto('/');
  const sourceTrip = await page.evaluate(async () => {
    const url = '/src/infrastructure/storage.ts';
    const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const trips = await db.listTrips(); db.close(); return trips[0];
  });
  await conflictPage.evaluate(async trip => {
    const url = '/src/infrastructure/storage.ts';
    const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); await db.createTrip({ ...trip, name: '別の旅行' }); db.close();
  }, sourceTrip!);
  await conflictPage.reload();
  await conflictPage.locator('#header-manage').click();
  await conflictPage.locator('#manage-archive').click();
  await conflictPage.locator('#archive-file').setInputFiles({ name: 'conflict.zip', mimeType: 'application/zip', buffer: archive });
  await conflictPage.getByRole('button', { name: '検証して復元' }).click();
  await expect(conflictPage.locator('#archive-status')).toContainText('同じIDの旅行に異なる内容');
  await expect(conflictPage.locator('#trip-select option')).toHaveCount(2);
  await conflicting.close();
});
