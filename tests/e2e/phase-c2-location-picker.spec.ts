import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = 'specs/phase-c4/screenshots';
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
    const fakedClock = (index: number) => `2026:01:0${index + 2} 10:00:00`;
    const photos = ['共通の海.jpg', '港の朝.jpg', '室内.jpg', '旅行の写真.jpg', '夕景.jpg'].map((name, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: name, sourceMime: 'image/jpeg', sourceByteLength: 1000,
      contentSha256: index.toString().padStart(64, '0'), thumbnailId: null, thumbnailState: 'failed',
      sourceGps: { rawTags: {}, normalized: index === 2 ? null : { latitude: 32.7 + index * .005, longitude: 129.8 + index * .005 },
        horizontalErrorMeters: null, datum: index === 2 ? null : 'WGS-84', status: index === 2 ? 'missing' : 'valid', issues: [] },
      gpsCorrection: null, sourceTime: { rawDateTimeOriginal: index < 2 ? fakedClock(index) : null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null,
        rawGpsTimeStamp: null, localClock: index < 2 ? fakedClock(index) : null, offsetMinutes: null, capturedAtUtc: null, status: index < 2 ? 'local-only' : 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    const owners = [[0, 1], [0], [0, 3], [], [1]];
    const links = photos.flatMap((photo, index) => owners[index]!.map(album => ({ photoId: photo.id, albumId: albums[album]!.id, createdAt: null })));
    albums[0] = { ...albums[0]!, representativeLocation: { longitude: 129.8, latitude: 32.7 }, locationSource: 'selected-photo', representativePhotoId: photos[0]!.id, userStartAtUtc: '2020-01-01T00:00:00.000Z', userEndAtUtc: '2020-01-02T00:00:00.000Z' };
    const db = await LibraryDb.open(); await db.restoreNew({ trips: [trip, other], visits: albums, photos, thumbnails: [], links }); db.close();
    return { trip: trip.id, other: other.id, albums: albums.map(item => item.id), photos: photos.map(item => item.id) };
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  mkdirSync(shots, { recursive: true });
  return ids;
}

// The location picker UI was retired in C2.1; its persisted legacy fields remain protected.
test('album name editing preserves legacy location and source fields without exposing location controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  const read = () => page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(), data = await db.snapshot(); db.close(); return data;
  });
  const before = await read();
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
  await expect(page.locator('#visit-summary')).not.toContainText('代表位置');
  await expect(page.locator('#visit-list')).not.toContainText('位置なし');
  await expect(page.locator('.visit-date-heading')).toHaveCount(0);
  await expect(page.locator('#visit-summary')).toContainText('2026/01/02 〜 2026/01/03');
  await expect(page.locator('#visit-summary')).not.toContainText('2020');
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${shots}/summary-1440.png` });
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 700) {
      await page.locator('#mobile-tab-visits').click();
      await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
      await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
    }
    await expect(page.locator('#visit-label')).toBeVisible();
    await expect(page.locator('#visit-start, #visit-end')).toHaveCount(0);
    await expect(page.locator('#visit-save')).toBeVisible();
    await expect(page.locator('#visit-edit-back')).toHaveText('キャンセル');
    await expect(page.locator('#visit-latitude, #visit-longitude, #visit-location-pick')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${shots}/edit-${width}.png` });
  }
  await page.locator('#visit-label').fill('港の写真アルバム');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-status')).toContainText('保存しました');
  const after = await read();
  const original = before.visits.find(visit => visit.id === ids.albums[0])!;
  const saved = after.visits.find(visit => visit.id === ids.albums[0])!;
  expect(saved).toEqual({ ...original, label: '港の写真アルバム', updatedAt: saved.updatedAt });
  expect(after.photos).toEqual(before.photos); expect(after.links).toEqual(before.links);
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-label').fill('保存しない名前');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#visit-edit-back').click();
  expect(await read()).toEqual(after);
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await page.locator(`.vpe-tile[data-tile-id="${ids.photos[4]}"] input[type=checkbox]`).check();
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('1枚追加');
  const afterMembership = await read();
  expect(afterMembership.visits.find(visit => visit.id === saved.id)).toEqual(saved);
  expect(afterMembership.photos).toEqual(before.photos);
});

test('new empty album needs only a name and no manual dates', async ({ page }) => {
  await seed(page);
  await page.locator('#left-tab-visits').click();
  const create = page.getByRole('button', { name: '新規アルバム', exact: true });
  await expect(create).toHaveAttribute('title', '新規アルバム');
  await create.click();
  await expect(page.locator('#visit-start, #visit-end, #visit-new')).toHaveCount(0);
  await page.locator('#visit-label').fill('写真を集めるアルバム');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-summary')).toContainText('写真を集めるアルバム');
  await expect(page.locator('#visit-summary')).toContainText('写真 0枚');
  await expect(page.locator('#visit-summary')).not.toContainText('設定日時');
  const saved = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const album = (await db.listVisits()).find(item => item.label === '写真を集めるアルバム'); db.close(); return album;
  });
  expect(saved).toMatchObject({ userStartAtUtc: null, userEndAtUtc: null, representativeLocation: null });
});

test('album icon actions retain accessible names, closing and confirmed trash behavior', async ({ page }) => {
  const ids = await seed(page);
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
  for (const name of ['写真を見る', '地図で見る', '編集']) {
    const control = page.locator('#visit-summary').getByRole('button', { name, exact: true });
    await expect(control).toHaveAttribute('title', name);
    await expect(control.locator('svg')).toHaveCount(1);
    const box = await control.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator('#right-close').click();
  await expect(page.locator('#right-panel')).not.toBeVisible();
  await page.locator(`#visit-list button[data-visit-id="${ids.albums[0]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('button', { name: 'アルバムをごみ箱へ移動', exact: true }).click();
  await expect(page.locator('#trash-confirm')).toBeVisible();
  await page.locator('#trash-commit').click();
  const album = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const found = (await db.listVisits()).find(item => item.id === id); db.close(); return found;
  }, ids.albums[0]!);
  expect(album?.deletedAt).not.toBeNull();
  expect(album?.userStartAtUtc).toBe('2020-01-01T00:00:00.000Z');
});

