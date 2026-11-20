import { expect, test, type Page } from '@playwright/test';

// The original Phase 5-C2 transfer tests were replaced by link-only add/remove tests.
// Response loss, write failure and trash-link cases also remain covered by phase-b4b1-album-editor.spec.ts.
async function seed(page: Page) {
  const origin = test.info().project.use.baseURL as string;
  const external: string[] = [];
  await page.route('**/*', route => route.request().url().startsWith(origin)
    ? route.continue() : (external.push(route.request().url()), route.abort('blockedbyclient')));
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const trip = newTrip('C2複数所属'), albums = ['アルバムA', 'アルバムB', '空のアルバム'].map(name => newVisit(trip.id, name));
    const names = ['A-1.jpg', 'A-2.jpg', 'B-1.jpg', '未所属.jpg'];
    const photos = names.map((name, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: name,
      sourceMime: 'image/jpeg', sourceByteLength: 100, contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
      gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null,
        rawGpsTimeStamp: null, localClock: null, offsetMinutes: null, capturedAtUtc: null,
        status: 'missing', evidence: 'none', issues: [] }, timeCorrection: null, sourceOrientation: null,
      thumbnailId: null, thumbnailState: 'failed', metadataIssues: [], importedAt: trip.createdAt,
      updatedAt: trip.createdAt, deletedAt: null,
    }));
    const links = [
      { albumId: albums[0]!.id, photoId: photos[0]!.id, createdAt: null },
      { albumId: albums[0]!.id, photoId: photos[1]!.id, createdAt: null },
      { albumId: albums[1]!.id, photoId: photos[2]!.id, createdAt: null },
    ];
    const db = await LibraryDb.open();
    await db.restoreNew({ trips: [trip], visits: albums, photos, thumbnails: [], links });
    db.close();
    return { tripId: trip.id, albumIds: albums.map(album => album.id), photoIds: photos.map(photo => photo.id) };
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.tripId);
  if (await page.evaluate(() => innerWidth <= 700)) await page.locator('#mobile-tab-visits').click();
  else await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albumIds[0]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
  return { ...ids, external };
}

const check = (page: Page, id: string) => page.locator(`.vpe-tile[data-tile-id="${id}"] input[type=checkbox]`);
async function links(page: Page, id: string) {
  return page.evaluate(async photoId => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const values = await db.albumIdsForPhoto(photoId); db.close(); return values;
  }, id);
}

test('preview does not toggle membership; mixed add/remove saves atomically and Undo restores all links', async ({ page }) => {
  const ids = await seed(page);
  await page.locator(`.vpe-tile[data-tile-id="${ids.photoIds[2]}"] .vpe-preview-button`).click();
  await expect(page.locator('#vpe-preview-source')).toContainText('アルバムB');
  await page.locator('#vpe-preview-close').click();
  await expect(check(page, ids.photoIds[2]!)).not.toBeChecked();
  await check(page, ids.photoIds[1]!).uncheck();
  await check(page, ids.photoIds[2]!).check();
  await check(page, ids.photoIds[3]!).check();
  await expect(page.locator('#vpe-counts')).toContainText('追加 2枚 · 解除 1枚');
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('2枚追加、1枚解除しました');
  expect(await links(page, ids.photoIds[0]!)).toEqual([ids.albumIds[0]]);
  expect(await links(page, ids.photoIds[1]!)).toEqual([]);
  expect(await links(page, ids.photoIds[2]!)).toEqual(expect.arrayContaining(ids.albumIds.slice(0, 2)));
  expect(await links(page, ids.photoIds[3]!)).toEqual([ids.albumIds[0]]);
  await page.locator('#vpe-undo').click();
  await expect(page.locator('#vpe-status')).toContainText('Undoしました');
  expect(await links(page, ids.photoIds[1]!)).toEqual([ids.albumIds[0]]);
  expect(await links(page, ids.photoIds[2]!)).toEqual([ids.albumIds[1]]);
  expect(await links(page, ids.photoIds[3]!)).toEqual([]);
  expect(ids.external).toEqual([]);
});

test('dirty leave and stale membership conflict retain the draft with no partial update', async ({ page }) => {
  const ids = await seed(page);
  await check(page, ids.photoIds[3]!).check();
  await page.locator('#header-manage').click();
  await expect(page.locator('#vpe-leave')).toBeVisible();
  await page.locator('#vpe-leave-stay').click();
  await expect(check(page, ids.photoIds[3]!)).toBeChecked();
  await page.evaluate(async ({ tripId, albumIds, photoId }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const [trip, albums, photos, current] = await Promise.all([
      db.getTrip(tripId), db.listVisits(), db.listPhotos(), db.listPhotoAlbumLinks(photoId),
    ]);
    await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: trip!,
      expectedAlbums: albums.filter(album => albumIds.slice(0, 2).includes(album.id)),
      changes: [{ beforePhoto: photos.find(photo => photo.id === photoId)!, expectedLinks: current,
        afterAlbumIds: [albumIds[0]!, albumIds[1]!] }] });
    db.close();
  }, { tripId: ids.tripId, albumIds: ids.albumIds, photoId: ids.photoIds[2]! });
  await check(page, ids.photoIds[2]!).check();
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-conflict')).toBeVisible();
  await expect(check(page, ids.photoIds[3]!)).toBeChecked();
  expect(await links(page, ids.photoIds[3]!)).toEqual([]);
  expect(ids.external).toEqual([]);
});

test('mobile editor keeps its selected tab, scrollable candidates and reachable actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ids = await seed(page);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'visits');
  await check(page, ids.photoIds[3]!).check();
  await page.locator('#mobile-tab-photos').click();
  await expect(page.locator('#vpe-leave')).toBeVisible();
  await page.locator('#vpe-leave-stay').click();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator('#vpe-save')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#vpe-close').click(); await page.locator('#vpe-leave-discard').click();
  await expect(page.locator('#visit-summary')).toBeVisible();
  expect(ids.external).toEqual([]);
});

test('resizing an open desktop album editor selects the album tab on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'visits');
  await expect(page.locator('#mobile-tab-visits')).toHaveAttribute('aria-current', 'page');
  await page.locator('#vpe-close').click();
  await expect(page.locator('#visit-summary')).toBeVisible();
  expect(ids.external).toEqual([]);
});

test('empty album can open its photo editor without inventing dates or membership', async ({ page }) => {
  const ids = await seed(page);
  await page.locator('#vpe-close').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albumIds[2]}"]`).click();
  await expect(page.locator('#visit-summary')).toContainText('写真 0枚');
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await expect(page.locator('#vpe-counts')).toContainText('選択 0枚');
  await expect(page.locator('#vpe-save')).toBeDisabled();
  expect(ids.external).toEqual([]);
});
