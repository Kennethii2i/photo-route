import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { localUi, createTripUi, photoListUi } from './helpers/ux-rc-flows';
test.use({ actionTimeout: 7000 });

const shots = 'test-results/phase-a1-shots';

async function localOnly(page: Page): Promise<string[]> {
  return localUi(page);
}

async function capture(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${shots}/${name}.png` });
}

test('management groups and keyboard controls fit 900, 390 and 320 pixels', async ({ page }) => {
  const external = await localOnly(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/');
  await page.locator('#header-manage').click();
  await expect(page.locator('#archive-heading')).toBeVisible();
  await expect(page.locator('#restore-button')).toBeDisabled();
  await expect(page.locator('#archive-cancel')).toBeHidden();
  await expect(page.locator('#stream-export-button')).toBeVisible();
  await capture(page, 'phase-a1-pc-900-initial');

  for (const [width, height] of [[390, 844], [320, 640]] as const) {
    await page.setViewportSize({ width, height });
    await page.locator('#management-close').click();
    await page.locator('#header-manage').click();
    await capture(page, `phase-a1-mobile-${width}-initial`);
    const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth,
      panel: document.querySelector<HTMLElement>('#management-panel')!.scrollWidth,
      panelWidth: document.querySelector<HTMLElement>('#management-panel')!.clientWidth }));
    expect(sizes.page).toBeLessThanOrEqual(width);
    expect(sizes.panel).toBeLessThanOrEqual(sizes.panelWidth + 1);
  }

  await page.locator('#manage-recovery').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#trash-count')).toHaveText('0件');
  await expect(page.locator('#trash-section')).toBeHidden();
  await expect(page.locator('#undo-button')).toBeDisabled();
  await expect(page.locator('#undo-summary')).toContainText('元に戻せる操作はありません');
  await page.locator('#manage-archive').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#archive-heading')).toBeVisible();
  await page.locator('#management-close').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-management-open', 'false');
  expect(external).toEqual([]);
});

test('small ZIP, file selection, failure, trash and Undo remain usable', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const external = await localOnly(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/');
  await createTripUi(page, '合成：管理画面の旅行'); await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg',
    buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') });
  await page.locator('#import-button').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#import-done').click(); await page.locator('#header-manage').click(); await page.locator('#archive-heading').scrollIntoViewIfNeeded();

  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    const original = LibraryDb.prototype.snapshot;
    LibraryDb.prototype.snapshot = async function () {
      await new Promise(resolve => setTimeout(resolve, 3_000));
      return original.call(this);
    };
  });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  await expect(page.locator('#archive-cancel')).toBeVisible();
  await expect(page.locator('#archive-status')).toContainText('アーカイブを作成しています');
  await page.screenshot({ path: `${shots}/phase-a1-backup-running.png` });
  const download = await downloadPromise;
  const zip = readFileSync(await download.path());
  expect(zip.length).toBeGreaterThan(100);
  await expect(page.locator('#archive-cancel')).toBeHidden();
  await capture(page, 'phase-a1-pc-900-backup-restore');

  const fresh = await browser.newContext();
  const target = await fresh.newPage();
  const freshExternal = await localOnly(target);
  await target.setViewportSize({ width: 900, height: 800 });
  await target.goto('/');
  await target.locator('#header-manage').click();
  await expect(target.locator('#restore-button')).toBeDisabled();
  await target.locator('#archive-file').setInputFiles({ name: 'synthetic-backup.zip', mimeType: 'application/zip', buffer: zip });
  await expect(target.locator('#archive-file-summary')).toContainText('synthetic-backup.zip');
  await expect(target.locator('#restore-button')).toBeEnabled();
  await capture(target, 'phase-a1-file-selected');
  await target.locator('#restore-button').click();
  await expect(target.locator('#archive-status')).toContainText('1件の旅行と1件の写真を復元');
  await target.locator('#management-close').click();
  await target.locator('#trip-select').selectOption({ label: '合成：管理画面の旅行' });
  await expect(target.locator('#photo-list button')).toHaveCount(1);
  await target.locator('#header-manage').click();
  await target.locator('#archive-file').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from([1, 2, 3]) });
  await target.locator('#restore-button').click();
  await expect(target.locator('#archive-status')).toContainText('復元を拒否');
  await expect(target.locator('#photo-list button')).toHaveCount(1);
  expect(freshExternal).toEqual([]);
  await fresh.close();

  await page.locator('#management-close').click();
  await photoListUi(page);
  await page.locator('#photo-list button').click();
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-advanced > summary').click();
  await page.getByRole('button', { name: 'この写真をごみ箱へ' }).click();
  await page.locator('#trash-commit').click();
  await expect(page.locator('#management-panel')).not.toBeVisible(); await page.locator('#header-manage').click();
  await page.locator('#trash-section > summary').click();
  await expect(page.locator('#trash-count')).toHaveText('1件');
  await expect(page.locator('#trash-section')).toHaveAttribute('open', '');
  await expect(page.locator('#undo-summary')).toContainText('写真をごみ箱へ移動');
  await capture(page, 'phase-a1-trash-open');
  await page.locator('#undo-button').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#management-close').click();
  await photoListUi(page);
  await page.locator('#photo-list button').click();
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-advanced > summary').click();
  await page.getByRole('button', { name: 'この写真をごみ箱へ' }).click();
  await page.locator('#trash-commit').click();
  await expect(page.locator('#management-panel')).not.toBeVisible(); await page.locator('#header-manage').click();
  await page.locator('#trash-section > summary').click();
  await page.getByRole('button', { name: '写真: synthetic.jpgを復元' }).click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  expect(external).toEqual([]);
});
