import { expect, test, type Page } from '@playwright/test';
import { seedUi } from './helpers/ui-package';

async function candidates(page: Page, albumId: string) {
  return page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { linkedVisitPhotos } = await import('../../src/presentation/visit-view');
    const db = await LibraryDb.open();
    try {
      const data = await db.snapshot(), album = data.visits.find(visit => visit.id === id)!;
      const linkedIds = new Set(data.links.filter(link => link.albumId === id).map(link => link.photoId));
      const ordered = linkedVisitPhotos(data.photos, album, linkedIds);
      const tied = data.photos.map(photo => ({ ...photo, timeCorrection: null, sourceTime: { ...photo.sourceTime, localClock: '2026:01:01 10:00:00' } }));
      const tieOrder = linkedVisitPhotos(tied, album, linkedIds).map(photo => photo.id);
      const reversed = linkedVisitPhotos([...tied].reverse(), album, linkedIds).map(photo => photo.id);
      return { ordered: ordered.map(photo => ({ id: photo.id, name: photo.originalFilename, thumbnailId: photo.thumbnailId })), tieOrder, reversed };
    } finally { db.close(); }
  }, albumId);
}
async function checkCover(page: Page, albumId: string, expected: { name: string; thumbnailId: string | null }) {
  await expect(page.locator(`#visit-list [data-visit-id="${albumId}"] .visit-list-cover`)).toHaveAttribute('data-thumbnail-id', expected.thumbnailId!);
  await page.locator(`#visit-list [data-visit-id="${albumId}"]`).click();
  await expect(page.locator('.visit-summary-cover')).toHaveAttribute('aria-label', `${expected.name} のプレビュー`);
  await expect(page.locator('.visit-summary-cover img')).toBeVisible();
}
test('automatic covers stay stable agree across views and handle unlink delete empty and thumbnail failure', async ({ page }) => {
  const ids = await seedUi(page), albumId = ids.albums[0]!;
  const first = await candidates(page, albumId);
  expect(first.tieOrder).toEqual(first.reversed); expect(first.tieOrder).toEqual([...first.tieOrder].sort((a, b) => a.localeCompare(b)));
  await page.locator('#left-tab-visits').click(); await checkCover(page, albumId, first.ordered[0]!);
  await page.getByRole('button', { name: '編集', exact: true }).click(); await page.locator('#visit-photo-edit-open').click();
  await page.locator('#vpe-search').fill(first.ordered[0]!.name); await expect(page.locator('.vpe-tile input')).toBeChecked();
  await page.locator('.vpe-tile input').click(); await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('解除'); await page.locator('#vpe-close').click();
  const second = await candidates(page, albumId); expect(second.ordered[0]!.id).not.toBe(first.ordered[0]!.id);
  await checkCover(page, albumId, second.ordered[0]!);
  const emptyId = await page.evaluate(async ({ photoId, tripId }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const { newVisit } = await import('../../src/domain/visits');
    const db = await LibraryDb.open(); const empty = newVisit(tripId, '空の合成アルバム');
    try { await db.moveToTrash('photo', photoId); await db.createVisit(empty); return empty.id; } finally { db.close(); }
  }, { photoId: second.ordered[0]!.id, tripId: ids.trip });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  const third = await candidates(page, albumId); expect(third.ordered[0]!.id).not.toBe(second.ordered[0]!.id);
  await page.locator('#left-tab-visits').click(); await checkCover(page, albumId, third.ordered[0]!);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  await page.evaluate(async thumbnailId => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.getThumbnail;
    LibraryDb.prototype.getThumbnail = async function (id) {
      if (id === thumbnailId) throw new Error('synthetic thumbnail read failure');
      return original.call(this, id);
    };
  }, third.ordered[0]!.thumbnailId);
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${albumId}"]`).click();
  await expect(page.locator('.visit-summary-cover')).toContainText('画像なし');
  expect((await page.locator('.visit-summary-cover').boundingBox())!.height).toBeGreaterThan(100);
  await page.locator(`#visit-list [data-visit-id="${emptyId}"]`).click();
  await expect(page.locator('.visit-summary-cover')).toContainText('写真なし'); await expect(page.locator('.visit-summary-count')).toHaveText('写真 0枚');
});
