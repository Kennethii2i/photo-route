import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = 'specs/phase-c1/screenshots';
async function seed(page: Page) {
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const trip = newTrip('合成：港の休日'), other = newTrip('別の旅行');
    const albums = ['港の散歩', '海辺の風景', '空のアルバム', 'GPSなし'].map(name => newVisit(trip.id, name));
    const photos = ['共通の海.jpg', '港の朝.jpg', '室内.jpg', '旅行の写真.jpg', '夕景.jpg'].map((name, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: name, sourceMime: 'image/jpeg', sourceByteLength: 1000,
      contentSha256: index.toString().padStart(64, '0'), thumbnailId: null, thumbnailState: 'failed',
      sourceGps: { rawTags: {}, normalized: index === 2 ? null : { latitude: 32.7 + index * .005, longitude: 129.8 + index * .005 },
        horizontalErrorMeters: null, datum: index === 2 ? null : 'WGS-84', status: index === 2 ? 'missing' : 'valid', issues: [] },
      gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null,
        rawGpsTimeStamp: null, localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    const owners = [[0, 1], [0], [0, 3], [], [1]];
    const links = photos.flatMap((photo, index) => owners[index]!.map(album => ({ photoId: photo.id, albumId: albums[album]!.id, createdAt: null })));
    const db = await LibraryDb.open(); await db.restoreNew({ trips: [trip, other], visits: albums, photos, thumbnails: [], links }); db.close();
    return { trip: trip.id, other: other.id, albums: albums.map(item => item.id), photos: photos.map(item => item.id) };
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  mkdirSync(shots, { recursive: true });
  return ids;
}
async function openAlbum(page: Page, id: string, mobile = false) {
  if (!mobile && !await page.locator('#left-tab-visits').isVisible()) await page.locator('#header-left').click();
  await page.locator(mobile ? '#mobile-tab-visits' : '#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${id}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
}
async function markerIds(page: Page) {
  return page.locator('#map-marker-list button').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.markerId).sort());
}

test('album-only map overrides search temporarily and restores the normal photo and layer state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  await page.locator('#photo-search').fill('旅行の写真');
  await expect.poll(() => markerIds(page)).toEqual([ids.photos[3]]);
  await page.locator('#header-left').click();
  await expect(page.locator('.map-photo-thumb')).toHaveCount(1);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/normal-1440.png` });
  await openAlbum(page, ids.albums[0]!);
  await expect.poll(() => markerIds(page)).toEqual([ids.photos[0], ids.photos[1]].sort());
  await expect(page.locator('#photo-search')).toHaveValue('旅行の写真');
  await expect(page.locator('.map-photo-thumb.is-visit-focused')).toHaveCount(0);
  await page.locator('#header-left').click();
  await expect(page.locator('.map-photo-thumb')).toHaveCount(2);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/album-1440.png` });
  await page.locator('#visit-focus-exit').click();
  await expect.poll(() => markerIds(page)).toEqual([ids.photos[3]]);
  await expect(page.locator('#photo-search')).toHaveValue('旅行の写真');
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-mode-visits').click();
  const normalVisits = await markerIds(page);
  await openAlbum(page, ids.albums[0]!);
  await page.locator('#visit-focus-exit').click();
  await expect.poll(() => markerIds(page)).toEqual(normalVisits);
  await expect(page.locator('#map-mode-visits')).toHaveAttribute('aria-pressed', 'true');
});

test('shared photos appear once in either album; empty and GPS-free albums stay empty', async ({ page }) => {
  const ids = await seed(page);
  for (const [album, expected] of [[ids.albums[0]!, [ids.photos[0], ids.photos[1]]], [ids.albums[1]!, [ids.photos[0], ids.photos[4]]]] as const) {
    await openAlbum(page, album);
    await expect.poll(() => markerIds(page)).toEqual([...expected].sort());
    await page.locator('#header-left').click();
    await page.locator('#map-tools > summary').click();
    await page.locator('#map-fit').click();
    await page.locator('#map-tools > summary').click();
    await page.waitForTimeout(350);
    await expect(page.locator('.map-photo-thumb')).toHaveCount(2);
    const box = await page.locator('.map-photo-thumb').first().boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.locator('#photo-detail h3')).toBeVisible();
    await expect(page.locator('.map-photo-thumb.is-selected')).toHaveCount(1);
    await page.locator('#right-close').click();
    await page.locator('#visit-focus-exit').click();
  }
  for (const album of [ids.albums[2]!, ids.albums[3]!]) {
    await openAlbum(page, album);
    await expect.poll(() => markerIds(page)).toEqual([]);
    await expect(page.locator('#visit-focus-empty')).toContainText('地図に表示できる写真がありません');
    await page.locator('#visit-focus-exit').click();
  }
});

test('mobile album map opens the map tab and exits at 390 and 320 pixels', async ({ page }) => {
  const ids = await seed(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openAlbum(page, ids.albums[0]!, true);
    await expect(page.locator('#mobile-tab-map')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => markerIds(page)).toEqual([ids.photos[0], ids.photos[1]].sort());
    await expect(page.locator('#visit-focus-exit')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#visit-focus-all').click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${shots}/album-${width}.png` });
    await page.locator('#visit-focus-exit').click();
    await expect(page.locator('#visit-focus-banner')).toBeHidden();
    await expect.poll(() => markerIds(page)).toEqual([ids.photos[0], ids.photos[1], ids.photos[3], ids.photos[4]].sort());
  }
  await openAlbum(page, ids.albums[0]!, true);
  await page.locator('#trip-select').selectOption(ids.other);
  await expect(page.locator('#visit-focus-banner')).toBeHidden();
});
