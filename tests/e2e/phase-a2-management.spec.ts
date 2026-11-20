import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { localUi, createTripUi, photoListUi } from './helpers/ux-rc-flows';
test.use({ actionTimeout: 7000 });

const shots = 'test-results/phase-a2-shots';

async function localOnly(page: Page): Promise<string[]> {
  return localUi(page);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(180);
  await page.screenshot({ path: `${shots}/${name}.png` });
}

test('management dialog follows the reference layout and traps keyboard focus', async ({ page }) => {
  const external = await localOnly(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  for (const [width, height] of [[1440, 900], [900, 800], [390, 844], [320, 640]] as const) {
    await page.setViewportSize({ width, height });
    await page.locator('#header-manage').click();
    await expect(page.locator('#management-panel')).toHaveAttribute('open', '');
    await expect(page.locator('#archive-heading')).toBeVisible();
    await expect(page.locator('#restore-button')).toBeDisabled();
    await expect(page.locator('#trash-count')).toHaveText('0件');
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>('#management-panel')!;
      const cardGrid = document.querySelector<HTMLElement>('.manage-cards')!;
      const box = dialog.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        mobileTabsTop: document.querySelector<HTMLElement>('#mobile-tabs')!.getBoundingClientRect().top,
        pageWidth: document.documentElement.scrollWidth,
        dialogWidth: dialog.clientWidth, dialogScrollWidth: dialog.scrollWidth,
        columns: getComputedStyle(cardGrid).gridTemplateColumns.split(' ').length };
    });
    expect(metrics.left).toBeGreaterThanOrEqual(-1);
    expect(metrics.right).toBeLessThanOrEqual(width + 1);
    expect(metrics.top).toBeGreaterThanOrEqual(-1);
    expect(metrics.bottom).toBeLessThanOrEqual(height + 1);
    expect(metrics.pageWidth).toBeLessThanOrEqual(width);
    expect(metrics.dialogScrollWidth).toBeLessThanOrEqual(metrics.dialogWidth + 1);
    expect(metrics.columns).toBe(width <= 700 ? 1 : 2);
    await screenshot(page, `phase-a2-management-${width}`);
    if (width <= 700) {
      expect(metrics.bottom).toBeLessThanOrEqual(metrics.mobileTabsTop + 1);
      await page.locator('#undo-heading').scrollIntoViewIfNeeded();
      await expect(page.locator('#undo-button')).toBeVisible();
      await page.locator('#restore-heading').scrollIntoViewIfNeeded();
      await expect(page.locator('#archive-file')).toBeVisible();
    }
    for (let step = 0; step < 8; step++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.querySelector('#management-panel')!.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#management-panel')).not.toHaveAttribute('open', '');
    await expect(page.locator('#header-manage')).toBeFocused();
  }
  expect(external).toEqual([]);
});

test('backup, restore, trash and Undo remain visible in their dialog cards', async ({ page }) => {
  test.setTimeout(60_000);
  const external = await localOnly(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto('/');
  await createTripUi(page, '合成：A.2の旅行'); await page.locator('#header-add').click();
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
  await page.screenshot({ path: `${shots}/phase-a2-management-backup-running.png` });
  const zip = readFileSync(await (await downloadPromise).path());
  await expect(page.locator('#archive-cancel')).toBeHidden();
  await page.locator('#archive-file').setInputFiles({ name: 'synthetic.zip', mimeType: 'application/zip', buffer: zip });
  await expect(page.locator('#restore-button')).toBeEnabled();
  await screenshot(page, 'phase-a2-management-file-selected');
  await page.locator('#archive-file').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from([1, 2, 3]) });
  await page.locator('#restore-button').click();
  await expect(page.locator('#archive-status')).toContainText('復元を拒否');
  await screenshot(page, 'phase-a2-management-restore-error');
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
  await screenshot(page, 'phase-a2-management-trash-open');
  await page.locator('#undo-button').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  expect(external).toEqual([]);
});
