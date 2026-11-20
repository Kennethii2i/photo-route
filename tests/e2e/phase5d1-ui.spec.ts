import { expect, test, type Page } from '@playwright/test';

async function openEditor(page: Page) {
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const { sourceClockEvidence } = await import('../../src/domain/time');
    const db = await LibraryDb.open(), trip = newTrip('D1合成UI'), a = newVisit(trip.id, 'Visit A'), b = newVisit(trip.id, 'Visit B');
    const names = ['A.jpg', 'B.jpg', 'free.jpg'];
    const photos = names.map((name, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null,
      originalFilename: name, sourceMime: 'image/jpeg', sourceByteLength: 2_000_000,
      contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
      gpsCorrection: null, sourceTime: { ...sourceClockEvidence(null, null), rawDateTimeOriginal: null,
        rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] }, timeCorrection: null,
      sourceOrientation: null, thumbnailId: crypto.randomUUID(), thumbnailState: 'available',
      metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 140;
    const context = canvas.getContext('2d')!;
    const thumbnails = await Promise.all(photos.map(async (photo, index) => {
      context.fillStyle = ['#89ab83', '#c69670', '#6d9db6'][index]!; context.fillRect(0, 0, 180, 140);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .83));
      return { id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg' as const, width: 180, height: 140, byteLength: blob.size, blob };
    }));
    const links = [{ albumId: a.id, photoId: photos[0]!.id, createdAt: null },
      { albumId: b.id, photoId: photos[1]!.id, createdAt: null }];
    await db.restoreNew({ trips: [trip], visits: [a, b], photos, thumbnails, links }); db.close();
    return { tripId: trip.id, a: a.id, b: b.id, photos: photos.map(photo => photo.id) };
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.tripId);
  if (page.viewportSize()!.width <= 700) await page.locator('#mobile-tab-visits').click();
  else {
    if (page.viewportSize()!.width <= 1100) await page.locator('#header-left').click();
    await page.locator('#left-tab-visits').click();
  }
  await page.locator(`#visit-list button[data-visit-id="${ids.a}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await page.locator('#visit-photo-edit-open').click();
  return ids;
}

async function addLinkOutsideEditor(page: Page, photoId: string, albumId: string, tripId: string) {
  await page.evaluate(async ({ photoId, albumId, tripId }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const [trip, albums, photos, current] = await Promise.all([
      db.getTrip(tripId), db.listVisits(), db.listPhotos(), db.listPhotoAlbumLinks(photoId),
    ]);
    await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: trip!,
      expectedAlbums: albums.filter(album => album.id === albumId || current.some(link => link.albumId === album.id)),
      changes: [{ beforePhoto: photos.find(photo => photo.id === photoId)!, expectedLinks: current,
        afterAlbumIds: [...current.map(link => link.albumId), albumId] }] });
    db.close();
  }, { photoId, albumId, tripId });
}

test('desktop editor traps focus, separates preview and checkbox, and explains a stale save', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await openEditor(page);
  await expect(page.locator('#vpe-search')).toBeFocused();
  await expect(page.locator('#visit-photo-editor-backdrop')).toBeVisible();
  await expect(page.locator('#right-panel')).toHaveAttribute('inert', '');
  await expect(page.locator('.map-panel')).toHaveAttribute('inert', '');
  await expect(page.locator('#vpe-scroll')).toHaveJSProperty('scrollTop', 0);
  await page.locator('#vpe-search').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#vpe-close')).toBeFocused();
  await page.locator('button[aria-label="B.jpgをプレビュー"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#vpe-preview-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#vpe-preview')).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'B.jpgをこのアルバムに所属させる' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'B.jpgをこのアルバムに所属させる' }).check();
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('1枚追加');
  await page.getByRole('checkbox', { name: 'free.jpgをこのアルバムに所属させる' }).check();
  await addLinkOutsideEditor(page, ids.photos[2]!, ids.b, ids.tripId);
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-conflict')).toBeVisible();
  await expect(page.locator('#vpe-conflict-reason')).toContainText('free.jpg');
  await expect(page.locator('#vpe-conflict-reason')).not.toContainText('photo-changed');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5d1-desktop-conflict.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#vpe-conflict')).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'free.jpgをこのアルバムに所属させる' })).toBeChecked();
  await page.locator('#vpe-close').click();
  await expect(page.locator('#vpe-leave-save')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#vpe-leave')).toBeHidden();
  await page.locator('#vpe-close').click();
  await page.locator('#vpe-leave-discard').click();
  await expect(page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true })).toBeFocused();
  await expect(page.locator('#right-panel')).not.toHaveAttribute('inert', '');
});

test('later membership change prevents stale batch Undo without losing links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await openEditor(page);
  await page.getByRole('checkbox', { name: 'free.jpgをこのアルバムに所属させる' }).check();
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-undo')).toBeEnabled();
  await addLinkOutsideEditor(page, ids.photos[2]!, ids.b, ids.tripId);
  await page.locator('#vpe-undo').click();
  await expect(page.locator('#vpe-conflict')).toBeVisible();
  await expect(page.locator('#vpe-conflict-reason')).not.toContainText('undo-order-or-photo-changed');
  const links = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const values = await db.albumIdsForPhoto(id); db.close(); return values;
  }, ids.photos[2]!);
  expect(links).toEqual(expect.arrayContaining([ids.a, ids.b]));
});

for (const viewport of [{ width: 320, height: 520 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}px mobile preview, leave and conflict dialogs remain reachable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const ids = await openEditor(page);
    const inside = async (selector: string) => {
      const root = page.locator('#visit-photo-editor-overlay');
      await expect(root).toBeVisible();
      await expect.poll(() => root.boundingBox()).not.toBeNull();
      const overlay = await root.boundingBox();
      const box = await page.locator(selector).boundingBox();
      expect(overlay).not.toBeNull();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(overlay!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(overlay!.x + overlay!.width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(overlay!.y - 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(overlay!.y + overlay!.height + 1);
    };
    await inside('.vpe-footer');
    await page.locator('button[aria-label="B.jpgをプレビュー"]').click();
    await inside('#vpe-preview .vpe-dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('checkbox', { name: 'B.jpgをこのアルバムに所属させる' }).check();
    await page.locator('#mobile-tab-photos').click();
    await inside('#vpe-leave .vpe-dialog');
    await page.locator('#vpe-leave-stay').click();
    const beforeUnloadPrevented = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
    });
    expect(beforeUnloadPrevented).toBe(true);
    await addLinkOutsideEditor(page, ids.photos[1]!, ids.a, ids.tripId);
    await page.locator('#vpe-save').click();
    await expect(page.locator('#vpe-conflict')).toBeVisible();
    await inside('#vpe-conflict .vpe-dialog');
    await page.locator('#vpe-conflict-close').click();
    await expect(page.locator('#vpe-conflict')).toBeHidden();
  });
}
