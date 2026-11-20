import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
const jpeg = 'fixtures/generated/jpeg_gps_offset_orientation6.jpg';
const folder = 'specs/ux-r6/screenshots/after';
async function shot(page: Page, name: string) {
  mkdirSync(folder, { recursive: true });
  await expect(page.locator('#photo-import-dialog')).toBeVisible();
  expect(await page.locator('#photo-import-dialog').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
  await page.screenshot({ path: `${folder}/${name}.png` });
}
async function savedPhotos(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const photos = await db.listPhotos(); db.close(); return photos;
  });
}

test('R6 selection, completion and failures use truthful compact states', async ({ page }) => {
  const ids = await seedUi(page);
  await page.locator('#header-add').click();
  const dialog = page.locator('#photo-import-dialog');
  await expect(page.locator('#management-panel')).toBeHidden();
  await expect(page.locator('#import-button')).toBeDisabled();
  await expect(page.locator('#duplicate-other-trip')).not.toBeChecked();
  await expect(page.locator('#import-options')).not.toHaveAttribute('open');
  await expect(dialog).toContainText('元の高解像度写真は保存されません');
  const metrics = [];
  for (const [name, width, height] of [['pc1440-empty', 1440, 900], ['mobile320-empty', 320, 740], ['mobile390-empty', 390, 844]] as const) {
    await page.setViewportSize({ width, height }); await shot(page, name);
    metrics.push({ name, ...await dialog.evaluate(el => ({ height: el.getBoundingClientRect().height, text: (el as HTMLElement).innerText.length })) });
  }
  await page.locator('#photo-files').focus();
  await expect(page.locator('#photo-files')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#import-options > summary')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#duplicate-other-trip')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.locator('#photo-files').setInputFiles(jpeg);
  await expect(page.locator('#import-selection-count')).toHaveText('1枚選択');
  await expect(page.locator('#import-button')).toBeEnabled(); await shot(page, 'mobile390-selected');
  await page.evaluate(async () => {
    const { PhotoImporter } = await import('../../src/application/import-photos.ts');
    const original = PhotoImporter.prototype.importFiles;
    PhotoImporter.prototype.importFiles = async function (...args) {
      await new Promise<void>(resolve => { Object.assign(window, { __releaseImport: resolve }); });
      PhotoImporter.prototype.importFiles = original;
      return original.apply(this, args);
    };
  });
  await page.locator('#import-button').click();
  await expect(page.locator('#cancel-button')).toBeFocused();
  await expect(page.locator('#import-status')).toContainText('開始しています');
  await expect(page.locator('#import-progress')).not.toHaveAttribute('value');
  await shot(page, 'mobile390-running');
  await page.evaluate(() => (window as unknown as { __releaseImport(): void }).__releaseImport());
  await expect(dialog).toHaveAttribute('data-import-state', 'done');
  await expect(page.locator('#import-done')).toBeFocused();
  await expect(page.locator('#import-status')).toContainText('追加 1枚・重複スキップ 0枚・失敗 0枚');
  await expect(page.locator('#cancel-button')).toBeHidden();
  const photo = (await savedPhotos(page)).find(p => p.originalFilename === 'jpeg_gps_offset_orientation6.jpg')!;
  expect(photo.tripId).toBe(ids.trip); expect(photo.sourceTime.rawDateTimeOriginal).toBeTruthy();
  expect(photo.thumbnailState).toBe('available');
  await shot(page, 'mobile390-done');
  await page.locator('#import-done').click(); await expect(page.locator('#header-add')).toBeFocused();
  await page.locator('#import-task').click(); await expect(dialog).toHaveAttribute('data-import-state', 'done');
  // The original native input still accepts multiple files and long names.
  const nextPicker = page.waitForEvent('filechooser');
  await page.locator('#import-again').click();
  await (await nextPicker).setFiles([
    { name: `${'長い名前'.repeat(30)}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from([1]) },
  ]);
  await expect(page.locator('#import-selection-count')).toHaveText('2枚選択');
  await page.locator('#import-button').click();
  await expect(dialog).toHaveAttribute('data-import-state', 'error');
  await expect(page.locator('#import-status')).toContainText('失敗 2枚');
  await expect(page.locator('#import-status')).toContainText('選び直してください');
  await page.locator('#import-result-details > summary').click(); await shot(page, 'mobile390-error');
  expect(await savedPhotos(page)).toHaveLength(25);
  // A job-level failure must not display a successful completion.
  await page.locator('#photo-files').setInputFiles(jpeg);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    LibraryDb.prototype.saveJob = async () => { throw new Error('合成書き込み失敗'); };
  });
  await page.locator('#import-button').click();
  await expect(page.locator('#import-status')).toContainText('合成書き込み失敗');
  await expect(page.locator('#import-status')).not.toContainText('完了しました');
  expect(await savedPhotos(page)).toHaveLength(25);
  writeFileSync('specs/ux-r6/after-metrics.json', JSON.stringify(metrics, null, 2));
});

test('R6 details preserve default duplicate skips and the explicit cross-Trip exception', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true });
  await page.locator('#header-add').click(); await page.locator('#photo-files').setInputFiles(jpeg);
  await page.locator('#import-button').click();
  await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'done');
  const original = (await savedPhotos(page)).find(p => p.originalFilename === 'jpeg_gps_offset_orientation6.jpg')!;
  await page.locator('#import-done').click(); await page.locator('#trip-select').selectOption(ids.otherTrip!);
  await page.locator('#header-add').click(); await page.locator('#photo-files').setInputFiles(jpeg);
  await expect(page.locator('#duplicate-other-trip')).not.toBeChecked();
  await page.locator('#import-button').click(); await expect(page.locator('#import-status')).toContainText('重複スキップ 1枚');
  expect(await savedPhotos(page)).toHaveLength(25);
  await page.locator('#photo-files').setInputFiles(jpeg);
  await page.locator('#import-options > summary').click(); await page.locator('#duplicate-other-trip').check();
  await page.setViewportSize({ width: 320, height: 420 }); await shot(page, 'mobile320-short-details');
  await page.locator('#import-button').click(); await expect(page.locator('#import-status')).toContainText('追加 1枚');
  const copies = (await savedPhotos(page)).filter(p => p.contentSha256 === original.contentSha256);
  expect(copies.map(p => p.tripId).sort()).toEqual([ids.trip, ids.otherTrip].sort());
  expect(copies.find(p => p.id === original.id)).toEqual(original);
  // Keeping the option checked still cannot duplicate a photo within one Trip.
  await page.locator('#photo-files').setInputFiles(jpeg);
  await page.locator('#import-options > summary').click(); await expect(page.locator('#duplicate-other-trip')).toBeChecked();
  await page.locator('#import-button').click(); await expect(page.locator('#import-status')).toContainText('重複スキップ 1枚');
  expect(await savedPhotos(page)).toHaveLength(26);
});

test('R6 running progress reopens with the captured Trip and cancellation retains saved photos', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    const original = LibraryDb.prototype.savePhoto;
    LibraryDb.prototype.savePhoto = async function (...args) {
      const result = await original.apply(this, args);
      await new Promise<void>(resolve => { Object.assign(window, { __releaseSavedImport: resolve }); });
      return result;
    };
  });
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles([
    { name: 'committed.jpg', mimeType: 'image/jpeg', buffer: readFileSync(jpeg) },
    { name: 'not-processed.png', mimeType: 'image/png', buffer: readFileSync('fixtures/generated/png_no_metadata.png') },
  ]);
  await page.locator('#import-button').click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __releaseSavedImport?: unknown }).__releaseSavedImport)).toBe('function');
  await expect(page.locator('#import-progress')).toHaveAttribute('value', '0');
  await expect(page.locator('#import-status')).toHaveText('0/2枚を処理・残り 2枚');
  await page.locator('#import-close').click(); await expect(page.locator('#import-task')).toBeVisible();
  await page.locator('#trip-select').selectOption(ids.otherTrip!); await page.locator('#import-task').click();
  await expect(page.locator('#photo-import-trip')).toContainText('海辺の週末');
  await page.locator('#cancel-button').click(); await expect(page.locator('#cancel-button')).toBeDisabled();
  await page.evaluate(() => (window as unknown as { __releaseSavedImport(): void }).__releaseSavedImport());
  await expect(page.locator('#import-status')).toContainText('中断 1枚');
  await expect(page.locator('#import-status')).toContainText('保存済みの写真は残っています');
  const photos = await savedPhotos(page);
  expect(photos).toHaveLength(25);
  expect(photos.find(p => p.originalFilename === 'committed.jpg')?.tripId).toBe(ids.trip);
  expect(photos.some(p => p.originalFilename === 'not-processed.png')).toBe(false);
  await page.locator('#import-done').click(); await page.locator('#import-task').click();
  await expect(page.locator('#photo-import-trip')).toContainText('海辺の週末');
  await expect(page.locator('#import-status')).toContainText('中断 1枚');
  await page.keyboard.press('Escape'); await expect(page.locator('#photo-import-dialog')).toBeHidden();
});
