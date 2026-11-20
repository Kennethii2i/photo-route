import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('P1 keyboard library and export remain usable when WebGL map is unavailable', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return original.call(this, type, ...args);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  await page.locator('#trip-name').focus();
  await page.keyboard.type('キーボード旅行');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '旅行を作成' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#trip-select')).toHaveValue(/.+/);
  await page.locator('#trip-select').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#trip-select')).toHaveValue('');
  await page.keyboard.press('End');
  await expect(page.locator('#trip-select')).toHaveValue(/.+/);
  await page.locator('#photo-files').setInputFiles({ name: 'point.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') });
  await page.locator('#import-button').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#photo-list button').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#photo-detail')).toContainText('point.jpg');
  await expect(page.locator('#map-status')).toContainText('地図を利用できません');
  const download = page.waitForEvent('download');
  await page.locator('#export-button').focus(); await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
});
