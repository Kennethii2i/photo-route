import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function seed(page: Page, count = 4) {
  const seedStart = Date.now();
  const origin = test.info().project.use.baseURL as string;
  const external: string[] = [];
  await page.route('**/*', route => route.request().url().startsWith(origin)
    ? route.continue() : (external.push(route.request().url()), route.abort('blockedbyclient')));
  await page.goto('/');
  const ids = await page.evaluate(async count => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const trip = newTrip('合成アルバム旅行');
    const albums = ['港の散歩', 'お気に入り', '海辺の風景', 'ごみ箱のアルバム', '空のアルバム'].map(name => newVisit(trip.id, name));
    albums[3] = { ...albums[3]!, deletedAt: trip.createdAt };
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#86bdd2'; context.fillRect(0, 0, 256, 120);
    context.fillStyle = '#4b907a'; context.fillRect(0, 120, 256, 72);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .8));
    const thumbnailId = crypto.randomUUID();
    const photos = Array.from({ length: count }, (_, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null,
      originalFilename: `合成-${String(index).padStart(4, '0')}.jpg`, sourceMime: 'image/jpeg', sourceByteLength: 1_000_000,
      contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: index === 2 ? { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] }
        : { rawTags: {}, normalized: { latitude: 32.7 + index * .00001, longitude: 129.8 }, horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] },
      gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: index === 2 ? null : '2026:01:02 10:00:00', rawOffsetTimeOriginal: null,
        rawGpsDateStamp: null, rawGpsTimeStamp: null, localClock: index === 2 ? null : '2026:01:02 10:00:00',
        offsetMinutes: null, capturedAtUtc: null, status: index === 2 ? 'missing' : 'local-only', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, thumbnailId: index === 0 ? thumbnailId : null,
      thumbnailState: index === 0 ? 'available' : 'failed', metadataIssues: [],
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    const links = photos.flatMap((photo, index) => {
      if (count === 4 && index === 3) return [];
      const owners = count === 4 && index === 0 ? albums.slice(0, 4) : count === 4 && index === 1 ? albums.slice(0, 1) : albums.slice(0, 3);
      return owners.map(album => ({ photoId: photo.id, albumId: album.id, createdAt: null }));
    });
    const db = await LibraryDb.open();
    await db.restoreNew({ trips: [trip], visits: albums, photos, links,
      thumbnails: [{ id: thumbnailId, photoId: photos[0]!.id, mime: 'image/jpeg', width: 256, height: 192, byteLength: blob.size, blob }] });
    db.close();
    return { tripId: trip.id, albumIds: albums.map(album => album.id), photoIds: photos.map(photo => photo.id) };
  }, count);
  const seedMs = Date.now() - seedStart;
  const displayStart = Date.now();
  await page.reload();
  await page.locator('#trip-select').selectOption(ids.tripId);
  await expect(page.locator('#photo-count')).toContainText(`${count}件`);
  return { ...ids, external, seedMs, displayMs: Date.now() - displayStart };
}

test('multi-album list, detail, filter, map focus and trash restoration use links', async ({ page }) => {
  const ids = await seed(page);
  await page.locator('#left-tab-visits').click();
  const first = page.locator(`#visit-list button[data-visit-id="${ids.albumIds[0]}"]`);
  const second = page.locator(`#visit-list button[data-visit-id="${ids.albumIds[1]}"]`);
  await expect(first).toContainText('写真3枚');
  await expect(second).toContainText('写真2枚');
  await expect(page.locator(`#visit-list button[data-visit-id="${ids.albumIds[3]}"]`)).toHaveCount(0);
  await expect(page.locator(`#visit-list button[data-visit-id="${ids.albumIds[4]}"]`)).toContainText('写真0枚');
  await first.click();
  await expect(page.locator('#visit-summary')).toContainText('写真 3枚');
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await expect(page.locator('#visit-photo-edit-open')).toBeEnabled();
  await expect(page.locator('#visit-label')).toBeEnabled();
  await page.locator('#visit-edit-back').click();
  await page.getByRole('button', { name: '写真を見る' }).click();
  await expect(page.locator('#visit-all-count')).toContainText('3枚');
  await page.locator(`#visit-all-photo-list button[data-photo-id="${ids.photoIds[0]}"]`).click();
  await expect(page.locator('#photo-detail')).toContainText('アルバム:');
  await expect(page.locator('#photo-detail')).toContainText('ほか2件');
  await page.getByRole('button', { name: '詳細を見る' }).click();
  for (const name of ['港の散歩', 'お気に入り', '海辺の風景', 'ごみ箱のアルバム（ごみ箱）'])
    await expect(page.locator('#photo-detail')).toContainText(name);
  await page.locator('#left-tab-photos').click();
  await page.locator(`#photo-list button[data-photo-id="${ids.photoIds[1]}"]`).click();
  await expect(page.locator('#photo-detail')).toContainText('アルバム: 港の散歩');
  await page.locator(`#photo-list button[data-photo-id="${ids.photoIds[3]}"]`).click();
  await expect(page.locator('#photo-detail')).toContainText('アルバム未所属');
  await expect(page.getByRole('button', { name: 'この写真からアルバムを作成' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '関連付けを保存' })).toHaveCount(0);
  await page.locator('#photo-filter-more > summary').click();
  await page.locator('#photo-visit-filter').selectOption('unlinked');
  await expect(page.locator('#photo-list button[data-photo-id]')).toHaveCount(1);
  await expect(page.locator('#map-marker-count')).toContainText('1地点');
  await page.locator('#photo-visit-filter').selectOption('linked');
  await expect(page.locator('#photo-list button[data-photo-id]')).toHaveCount(3);
  await page.locator('#photo-filter-clear').click();
  await page.locator('#left-tab-visits').click();
  await first.click();
  await page.getByRole('button', { name: '地図で見る' }).click();
  await expect(page.locator('#visit-focus-message')).toContainText('所属3枚');
  await page.locator('#visit-focus-exit').click();
  await expect(page.locator('#visit-focus-banner')).toBeHidden();
  await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); await db.restoreFromTrash('visit', id); db.close();
  }, ids.albumIds[3]!);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.tripId);
  await page.locator('#left-tab-visits').click();
  await expect(page.locator(`#visit-list button[data-visit-id="${ids.albumIds[3]}"]`)).toContainText('写真1枚');
  expect(ids.external).toEqual([]);
});

test('isolated PC and mobile layouts show multi-album read state', async ({ page }) => {
  const ids = await seed(page);
  const folder = 'specs/phase-b4a/screenshots'; mkdirSync(folder, { recursive: true });
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.albumIds[0]}"]`).click();
  for (const [width, height] of [[1440, 900], [900, 800], [390, 844], [320, 700]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${folder}/album-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440 || width === 390) {
      await page.getByRole('button', { name: '写真を見る' }).click();
      await page.locator(`#visit-all-photo-list button[data-photo-id="${ids.photoIds[0]}"]`).click();
      await expect(page.locator('#photo-detail')).toContainText('ほか2件');
      await page.screenshot({ path: `${folder}/photo-${width}.png` });
      await page.getByRole('button', { name: 'アルバムへ戻る' }).click();
    }
  }
  expect(ids.external).toEqual([]);
});

for (const count of [1000, 5000]) test(`read path scales to ${count} photos with three links each`, async ({ page }) => {
  test.setTimeout(180_000);
  const ids = await seed(page, count);
  const albumStart = Date.now();
  await page.locator('#left-tab-visits').click();
  await expect(page.locator(`#visit-list button[data-visit-id="${ids.albumIds[0]}"]`)).toContainText(`写真${count}枚`);
  await page.locator(`#visit-list button[data-visit-id="${ids.albumIds[1]}"]`).click();
  await expect(page.locator('#visit-summary')).toContainText(`写真 ${count}枚`);
  const albumMs = Date.now() - albumStart;
  const searchStart = Date.now();
  await page.locator('#left-tab-photos').click();
  await page.locator('#photo-filter-more > summary').click();
  await page.locator('#photo-visit-filter').selectOption('linked');
  await expect(page.locator('#photo-count')).toContainText(`${count}件`);
  const searchMs = Date.now() - searchStart;
  const metrics = await page.evaluate(() => ({ dom: document.querySelectorAll('*').length,
    photoButtons: document.querySelectorAll('#photo-list button[data-photo-id]').length,
    heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null }));
  console.log(`B4a ${count}: seed ${ids.seedMs}ms, reload+display ${ids.displayMs}ms, album list+switch ${albumMs}ms, filter+map ${searchMs}ms, DOM ${metrics.dom}, photo buttons ${metrics.photoButtons}, JS heap ${metrics.heapBytes}`);
  expect(metrics.photoButtons).toBeLessThan(300);
  expect(ids.external).toEqual([]);
});
