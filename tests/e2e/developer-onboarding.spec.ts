import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createTripUi, localUi, photoListUi } from './helpers/ux-rc-flows';

test('fresh browser creates a trip, maps an imported GPS photo, and creates an album', async ({ page }) => {
  const unexpectedRequests = await localUi(page);
  await page.goto('/');
  await expect(page.locator('#photo-count')).toHaveText('写真 0枚');

  const tripId = await createTripUi(page, '合成：開発環境確認');
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles({
    name: 'synthetic-gps.jpg',
    mimeType: 'image/jpeg',
    buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg'),
  });
  await page.locator('#import-button').click();
  await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'done');
  await page.locator('#import-done').click();
  await photoListUi(page);
  await expect(page.locator('#photo-count')).toContainText('1枚');

  const imported = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const photos = await db.listPhotos();
    db.close();
    return photos.map(photo => ({ tripId: photo.tripId, gps: photo.sourceGps.normalized }));
  });
  expect(imported).toHaveLength(1);
  expect(imported[0]?.tripId).toBe(tripId);
  expect(imported[0]?.gps).not.toBeNull();

  await page.locator('#photo-list [data-photo-id]').first().click();
  await page.locator('#photo-detail').getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('.map-photo-thumb.is-selected')).toBeVisible();

  if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
  await page.locator('#left-tab-visits').click();
  await page.locator('#visit-create-from-list').click();
  await page.locator('#visit-label').fill('合成：確認用アルバム');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-summary h3')).toHaveText('合成：確認用アルバム');
  expect(unexpectedRequests).toEqual([]);
});
