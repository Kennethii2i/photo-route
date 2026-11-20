import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('P1 UI creates a Trip, imports synthetic photos, and keeps list/detail after reload', async ({ page }) => {
  test.setTimeout(60_000);
  const external: string[] = [];
  const dialogs: string[] = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5184/') && !request.url().startsWith('blob:http://127.0.0.1:5184/')) external.push(request.url()); });
  await page.goto('/');
  await page.locator('#header-manage').click();
  await page.getByLabel('新しい旅行名').fill('合成旅行');
  await page.getByRole('button', { name: '旅行を作成' }).click();
  await expect(page.locator('#trip-select')).toHaveValue(/.+/);
  await page.locator('#manage-import').click();
  await page.locator('#photo-files').setInputFiles([
    { name: '<script>alert(1)</script>.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') },
    { name: 'local.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_local_no_offset.jpg') },
    { name: 'point.png', mimeType: 'image/png', buffer: readFileSync('fixtures/generated/png_exif_gps.png') },
    { name: 'plain.webp', mimeType: 'image/webp', buffer: readFileSync('fixtures/generated/webp_no_metadata.webp') },
    { name: 'heic.heic', mimeType: 'image/heic', buffer: readFileSync('fixtures/heif/synthetic_gps_offset_orientation.heic') },
    { name: 'heif.heif', mimeType: 'image/heif', buffer: readFileSync('fixtures/heif/synthetic_no_metadata.heif') },
  ]);
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#import-status')).toContainText('6/6件', { timeout: 30_000 });
  await expect(page.locator('#map-status')).toContainText('背景地図は未選定');
  await expect(page.locator('#import-results')).toContainText('heic.heic: partial');
  await expect(page.locator('#import-results')).toContainText('heif.heif: partial');
  await expect(page.locator('#import-results')).toContainText('安全なサムネイル復号は未対応');
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-list button')).toHaveCount(6);
  await page.locator('#photo-list button[aria-label="local.jpg"]').click();
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-advanced > summary').click();
  await expect(page.locator('#photo-detail')).toContainText('UTC: 確定できません');
  await page.locator('#photo-list button[aria-label="heic.heic"]').click();
  await expect(page.locator('#photo-detail')).toContainText('原本写真を再選択');
  expect(dialogs).toEqual([]);
  expect(external).toEqual([]);
  await page.reload();
  await page.locator('#trip-select').selectOption({ label: '合成旅行' });
  await expect(page.locator('#photo-list button')).toHaveCount(6);
});
