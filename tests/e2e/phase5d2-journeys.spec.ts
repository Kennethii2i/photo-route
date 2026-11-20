import { expect, test, type Page } from '@playwright/test';

const shots = 'test-results/phase-a-shots';

async function settle(page: Page, path: string) {
  await page.waitForTimeout(260);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => undefined))); });
  await page.screenshot({ path: `${shots}/${path}.png` });
}

async function seed(page: Page) {
  const origin = test.info().project.use.baseURL as string;
  const external: string[] = [];
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue()
    : (external.push(route.request().url()), route.abort('blockedbyclient')));
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema, visitSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const { sourceClockEvidence } = await import('../../src/domain/time');
    const db = await LibraryDb.open(), trip = newTrip('合成：海辺の週末');
    const a = visitSchema.parse({ ...newVisit(trip.id, '港の散歩', null, { latitude: 32.73, longitude: 129.87 }),
      userStartAtUtc: '2026-01-02T01:00:00.000Z' });
    const b = visitSchema.parse({ ...newVisit(trip.id, 'カフェ休憩', null, { latitude: 32.731, longitude: 129.871 }),
      userStartAtUtc: '2026-01-02T04:00:00.000Z' });
    const names = ['海辺の朝.jpg', '港の街並み.jpg', '旅の昼食.jpg', '森の小径.jpg', '夕暮れの海.jpg', '古い建物.jpg', '位置のない写真.jpg'];
    const owners = [a.id, a.id, a.id, b.id, b.id, null, null];
    const coordinates: ([number, number] | null)[] = [[32.73, 129.87], [32.7302, 129.8701], [32.7304, 129.8702],
      [32.731, 129.871], [32.731, 129.871], [32.732, 129.872], null];
    const photos = names.map((name, index) => {
      const rawDateTimeOriginal = index === 6 ? null : `2026:01:0${index < 4 ? 2 : 3} ${String(9 + index).padStart(2, '0')}:30:00`;
      const rawOffsetTimeOriginal = rawDateTimeOriginal ? '+09:00' : null;
      const location = coordinates[index];
      return photoSchema.parse({ id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: name,
        sourceMime: 'image/jpeg', sourceByteLength: 3_000_000, contentSha256: index.toString(16).padStart(64, '0'),
        sourceGps: location ? { rawTags: {}, normalized: { latitude: location[0], longitude: location[1] },
          horizontalErrorMeters: 3, datum: 'WGS-84', status: 'valid', issues: [] }
          : { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
        gpsCorrection: null, sourceTime: { ...sourceClockEvidence(rawDateTimeOriginal, rawOffsetTimeOriginal),
          rawDateTimeOriginal, rawOffsetTimeOriginal, rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] },
        timeCorrection: null, sourceOrientation: null, thumbnailId: index === 6 ? null : crypto.randomUUID(),
        thumbnailState: index === 6 ? 'failed' : 'available', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null });
    });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d')!;
    const thumbnails = await Promise.all(photos.filter(photo => photo.thumbnailId).map(async (photo, index) => {
      const sky = context.createLinearGradient(0, 0, 0, 240);
      sky.addColorStop(0, ['#9bc9de', '#e1c4a3', '#dacda7', '#a4c3a4', '#eead8c', '#cfb4a0'][index]!);
      sky.addColorStop(1, ['#487d85', '#967965', '#a9875f', '#427255', '#8b6277', '#705a53'][index]!);
      context.fillStyle = sky; context.fillRect(0, 0, 320, 240);
      if (index === 0 || index === 4) {
        context.fillStyle = index === 0 ? '#f8e8bb' : '#ffe1b0'; context.beginPath(); context.arc(252, 60, 27, 0, Math.PI * 2); context.fill();
        context.fillStyle = index === 0 ? '#327e91' : '#696f86'; context.fillRect(0, 125, 320, 115);
        context.fillStyle = '#dfd2b1'; context.beginPath(); context.moveTo(0, 165); context.lineTo(180, 240); context.lineTo(0, 240); context.fill();
      } else if (index === 1 || index === 5) {
        for (let building = 0; building < 5; building++) {
          context.fillStyle = index === 1 ? ['#665c58', '#8c7167', '#b48468'][building % 3]! : '#9c6f57';
          const x = building * 70 - 10, height = 75 + building * 17;
          context.fillRect(x, 240 - height, 62, height);
          context.fillStyle = '#f2dfab';
          for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) context.fillRect(x + 10 + col * 25, 240 - height + 15 + row * 24, 10, 13);
        }
      } else if (index === 2) {
        context.fillStyle = '#8a5d44'; context.fillRect(0, 120, 320, 120);
        context.fillStyle = '#f4e9d2'; context.beginPath(); context.ellipse(160, 158, 110, 68, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#bd7144'; context.beginPath(); context.ellipse(160, 151, 74, 42, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#77a16a'; for (let leaf = 0; leaf < 6; leaf++) context.fillRect(100 + leaf * 24, 135 + leaf % 2 * 19, 19, 7);
      } else {
        context.fillStyle = '#d6c9a0'; context.beginPath(); context.moveTo(125, 240); context.lineTo(177, 240); context.lineTo(206, 120); context.lineTo(92, 120); context.fill();
        for (let tree = 0; tree < 6; tree++) {
          const x = tree * 58 - 2; context.fillStyle = '#5f553d'; context.fillRect(x + 16, 70, 10, 150);
          context.fillStyle = '#3d754c'; context.beginPath(); context.arc(x + 20, 75, 47, 0, Math.PI * 2); context.fill();
        }
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .85));
      return { id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg' as const,
        width: 320, height: 240, byteLength: blob.size, blob };
    }));
    const links = photos.flatMap((photo, index) => owners[index]
      ? [{ albumId: owners[index]!, photoId: photo.id, createdAt: null }] : []);
    await db.restoreNew({ trips: [trip], visits: [a, b], photos, thumbnails, links }); db.close();
    return { trip: trip.id, a: a.id, b: b.id, photos: photos.map(photo => photo.id) };
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  return { ...ids, external };
}

test('desktop journeys and final states at 1440, 1100 and 900 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  await expect(page.locator('#photo-list button')).toHaveCount(7);
  await settle(page, 'phase5d2-pc-1440-map-grid');
  await page.locator(`#photo-list button[data-photo-id="${ids.photos[0]}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('海辺の朝.jpg');
  await settle(page, 'phase5d2-pc-1440-preview');
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await expect(page.locator('#photo-advanced')).toBeVisible();
  await settle(page, 'phase5d2-pc-1440-detail');
  await page.locator('#right-close').click();
  await expect(page.locator(`#photo-list button[data-photo-id="${ids.photos[0]}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#photo-search').fill('港');
  await expect(page.locator('#map-marker-count')).toContainText('1地点');
  await page.locator('#photo-filter-clear').click();
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.a}"]`).click();
  await expect(page.locator('#visit-summary')).toContainText('写真 3枚');
  await settle(page, 'phase5d2-pc-1440-visit-summary');
  await page.getByRole('button', { name: '写真を見る' }).click();
  await expect(page.locator('#visit-all-count')).toContainText('3枚');
  await page.locator('#visit-all-back').click();
  await page.getByRole('button', { name: '地図で見る' }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await settle(page, 'phase5d2-pc-1440-visit-focus');
  await page.locator('#visit-focus-exit').click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await page.locator('#visit-photo-edit-open').click();
  await expect(page.locator('#vpe-scroll')).toHaveJSProperty('scrollTop', 0);
  await settle(page, 'phase5d2-pc-1440-editor');
  await page.getByRole('checkbox', { name: '海辺の朝.jpgをこのアルバムに所属させる' }).uncheck();
  await page.getByRole('checkbox', { name: '古い建物.jpgをこのアルバムに所属させる' }).check();
  await page.getByRole('checkbox', { name: '森の小径.jpgをこのアルバムに所属させる' }).check();
  await page.locator('#vpe-save').click();
  await settle(page, 'phase5d2-pc-1440-add-remove');
  await expect(page.locator('#vpe-status')).toContainText('2枚追加、1枚解除しました');
  await page.locator('#vpe-undo').click();
  await expect(page.locator('#vpe-status')).toContainText('Undoしました');
  await page.getByRole('checkbox', { name: '古い建物.jpgをこのアルバムに所属させる' }).check();
  await page.evaluate(async ({ photo, visit, trip }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const [expectedTrip, albums, photos, links] = await Promise.all([
      db.getTrip(trip), db.listVisits(), db.listPhotos(), db.listPhotoAlbumLinks(photo),
    ]);
    await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: expectedTrip!,
      expectedAlbums: albums.filter(album => album.id === visit),
      changes: [{ beforePhoto: photos.find(item => item.id === photo)!, expectedLinks: links, afterAlbumIds: [visit] }] });
    db.close();
  }, { photo: ids.photos[5]!, visit: ids.b, trip: ids.trip });
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-conflict')).toBeVisible();
  await settle(page, 'phase5d2-pc-1440-conflict');
  await page.locator('#vpe-conflict-close').click();
  await page.locator('#vpe-close').click();
  await page.locator('#vpe-leave-discard').click();
  await page.setViewportSize({ width: 1100, height: 800 });
  await settle(page, 'phase5d2-pc-1100');
  await page.setViewportSize({ width: 900, height: 800 });
  await settle(page, 'phase5d2-pc-900');
  await page.locator('#header-manage').click();
  await page.locator('#manage-archive').click();
  await expect(page.locator('#archive-heading')).toBeVisible();
  await expect(page.locator('#archive-heading').locator('..')).toContainText('元の高解像度写真は含まれません');
  await settle(page, 'phase-a-pc-900-management');
  await page.locator('#management-close').click();
  expect(ids.external).toEqual([]);
});

test('mobile journeys fit 390 and 320 pixels without losing selected Visit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ids = await seed(page);
  await settle(page, 'phase5d2-mobile-390-map');
  await page.locator('#mobile-tab-photos').click();
  await settle(page, 'phase5d2-mobile-390-photos');
  await page.locator(`#photo-list button[data-photo-id="${ids.photos[0]}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('海辺の朝.jpg');
  await settle(page, 'phase5d2-mobile-390-preview');
  await page.locator('#right-close').click();
  await page.locator('#mobile-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.a}"]`).click();
  await settle(page, 'phase5d2-mobile-390-visit-summary');
  await page.locator('#visit-summary').getByRole('button', { name: '地図で見る' }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await page.locator('#visit-focus-exit').click();
  await expect(page.locator(`#visit-list button[data-visit-id="${ids.a}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await page.locator('#visit-photo-edit-open').click();
  await settle(page, 'phase5d2-mobile-390-editor');
  await page.locator('#vpe-search').fill('森');
  await page.getByRole('checkbox', { name: '森の小径.jpgをこのアルバムに所属させる' }).check();
  await page.locator('#vpe-search').fill('');
  await page.locator('#mobile-tab-photos').click();
  await expect(page.locator('#vpe-leave')).toBeVisible();
  await page.locator('#vpe-leave-stay').click();
  await page.evaluate(async ({ photo, visit, other, trip }) => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const [expectedTrip, albums, photos, links] = await Promise.all([
      db.getTrip(trip), db.listVisits(), db.listPhotos(), db.listPhotoAlbumLinks(photo),
    ]);
    await db.saveAlbumMembershipBatch({ operationId: crypto.randomUUID(), expectedTrip: expectedTrip!,
      expectedAlbums: albums.filter(album => album.id === visit || album.id === other),
      changes: [{ beforePhoto: photos.find(item => item.id === photo)!, expectedLinks: links,
        afterAlbumIds: [visit, other] }] });
    db.close();
  }, { photo: ids.photos[3]!, visit: ids.a, other: ids.b, trip: ids.trip });
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-conflict')).toBeVisible();
  await settle(page, 'phase5d2-mobile-390-conflict');
  await page.locator('#vpe-conflict-close').click();
  await page.setViewportSize({ width: 320, height: 520 });
  await settle(page, 'phase5d2-mobile-320-editor');
  const tabs = await page.locator('#mobile-tabs').boundingBox();
  const footer = await page.locator('.vpe-footer').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(tabs!.y + 1);
  expect(ids.external).toEqual([]);
});

test('keyboard Space and Enter operate tabs, photo membership and background settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ids = await seed(page);
  await page.locator('#mobile-tab-photos').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'photos');
  await page.locator('#mobile-tab-visits').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'visits');
  await page.locator(`#visit-list button[data-visit-id="${ids.a}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await page.locator('#visit-photo-edit-open').click();
  const checkbox = page.getByRole('checkbox', { name: '古い建物.jpgをこのアルバムに所属させる' });
  await checkbox.focus();
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await page.locator('button[aria-label="古い建物.jpgをプレビュー"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#vpe-preview-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('button[aria-label="古い建物.jpgをプレビュー"]')).toBeFocused();
  await page.locator('#vpe-close').click();
  await page.locator('#vpe-leave-discard').click();
  await page.locator('#mobile-tab-map').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'map');
  await page.locator('#map-tools > summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#map-tools')).toHaveAttribute('open', '');
  await expect(page.locator('#basemap-privacy')).toContainText('閲覧地域');
  await expect(page.locator('#basemap-toggle')).not.toBeChecked();
  expect(ids.external).toEqual([]);
});
