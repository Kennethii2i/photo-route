import { test, expect } from '@playwright/test';
import { emptyLibrary, shot } from './helpers/ia-flows';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
test('IA-2a empty travel creation cancels without writes then returns to photo addition', async ({ page }) => {
  await emptyLibrary(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#header-add').click(); await expect(page.locator('#trip-create-dialog')).toBeVisible();
  await shot(page, 'ia2a-mobile390-no-trips');
  await page.locator('#trip-name').fill('キャンセルする旅行'); await page.locator('#trip-create-cancel').click();
  const counts = await page.evaluate(async () => { const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const counts = [(await db.listTrips()).length, (await db.listPhotos()).length]; db.close(); return counts; });
  expect(counts).toEqual([0, 0]);
  await page.locator('#header-add').click(); await page.locator('#trip-name').fill('合成：海辺の週末');
  await page.locator('#trip-create-submit').click(); await expect(page.locator('#trip-create-status')).toContainText('作成しました');
  await expect(page.locator('#trip-select option:checked')).toHaveText('合成：海辺の週末');
  await page.locator('#trip-create-submit').click(); await expect(page.locator('#photo-import-dialog')).toBeVisible();
  await expect(page.locator('#photo-import-trip')).toContainText('合成：海辺の週末');
  await page.setViewportSize({ width: 320, height: 740 }); await shot(page, 'ia2a-mobile320-import');
});
test('IA-2a selector and management use one creation form and reject double submission', async ({ page }) => {
  await emptyLibrary(page); await page.locator('#trip-select').selectOption('__create-trip__');
  await page.locator('#trip-name').fill('合成：山の休日'); await shot(page, 'ia2a-pc1440-trip-create');
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.createTrip;
    LibraryDb.prototype.createTrip = async function (...args) {
      Object.assign(window, { __tripWrites: Number((window as unknown as { __tripWrites?: number }).__tripWrites ?? 0) + 1 });
      await new Promise<void>(resolve => { Object.assign(window, { __releaseTrip: resolve }); }); return original.apply(this, args);
    };
  });
  await page.locator('#trip-create-submit').click(); await expect(page.locator('#trip-create-submit')).toBeDisabled();
  await page.locator('#trip-form').dispatchEvent('submit'); await page.keyboard.press('Escape');
  await expect(page.locator('#trip-create-dialog')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __releaseTrip(): void }).__releaseTrip());
  await expect(page.locator('#trip-create-status')).toContainText('作成しました');
  expect(await page.evaluate(() => (window as unknown as { __tripWrites: number }).__tripWrites)).toBe(1);
  await page.locator('#trip-create-submit').click(); await shot(page, 'ia2a-pc1440-trip-selected');
  await page.locator('#header-manage').click(); await page.locator('#management-extra > summary').click(); await page.locator('#manage-trip').click();
  await expect(page.locator('#trip-create-dialog')).toBeVisible(); await expect(page.locator('#trip-form')).toHaveCount(1);
  await expect(page.locator('#management-panel')).toBeHidden();
});
test('IA-2a lost creation response keeps unknown state and checks the same ID without resending', async ({ page }) => {
  await emptyLibrary(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const create = LibraryDb.prototype.createTrip, get = LibraryDb.prototype.getTrip;
    LibraryDb.prototype.createTrip = async function (...args) { Object.assign(window, { __tripWrites: 1 }); await create.apply(this, args); throw new Error('合成応答喪失'); };
    LibraryDb.prototype.getTrip = async function (...args) { if (!(window as unknown as { __allowTripReads?: boolean }).__allowTripReads) throw new Error('合成照会失敗'); return get.apply(this, args); };
  });
  await page.locator('#trip-select').selectOption('__create-trip__'); await page.locator('#trip-name').fill('合成：保存確認');
  await page.locator('#trip-create-submit').click(); await expect(page.locator('#trip-create-status')).toContainText('保存結果を確認できません');
  await expect(page.locator('#trip-create-cancel')).toBeDisabled(); await page.keyboard.press('Escape'); await expect(page.locator('#trip-create-dialog')).toBeVisible();
  await page.evaluate(() => { Object.assign(window, { __allowTripReads: true }); });
  await page.locator('#trip-create-submit').click(); await expect(page.locator('#trip-create-status')).toContainText('作成しました');
  expect(await page.evaluate(async () => { const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const count = (await db.listTrips()).length; db.close(); return count; })).toBe(1);
});
