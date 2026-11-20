import { expect, test, type Page } from '@playwright/test';

async function seed(page: Page, withReference = true) {
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
  const result = await page.evaluate(async referencePhoto => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { sourceClockEvidence } = await import('../../src/domain/time');
    const db = await LibraryDb.open();
    const trip = newTrip('合成写真旅行');
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d')!;
    const shapes = [[240, 320], [320, 240], [280, 280]];
    const blobs: Blob[] = [];
    for (const [index, [width, height]] of shapes.entries()) {
      canvas.width = width!; canvas.height = height!;
      context.fillStyle = ['#c87962', '#648d81', '#6b84aa'][index]!; context.fillRect(0, 0, width!, height!);
      context.fillStyle = '#ffffffaa'; context.beginPath(); context.arc(width! / 2, height! / 2, width! / 4, 0, Math.PI * 2); context.fill();
      blobs.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encode failed')), 'image/jpeg', .8)));
    }
    const names = ['縦長.jpg', '横長.jpg', '正方形.jpg', '画像なし.jpg', '参考位置.jpg', '日時補正.jpg'];
    const clocks = ['2026:01:03 10:00:00', '2026:01:02 09:00:00', null, null, '2026:01:02 12:00:00', '2026:01:01 08:00:00'];
    const thumbs = [0, 1, 2, null, 0, 1];
    const photos = names.map((name, index) => {
      const rawDateTimeOriginal = clocks[index] ?? null;
      const sourceTime = { ...sourceClockEvidence(rawDateTimeOriginal, null), rawDateTimeOriginal, rawOffsetTimeOriginal: null,
        rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] };
      const reference = referencePhoto && index === 4;
      return photoSchema.parse({
        id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: name,
        sourceMime: 'image/jpeg', sourceByteLength: 1024, contentSha256: index.toString(16).padStart(64, '0'),
        sourceGps: reference ? { rawTags: { GPSLatitudeRef: 'N', GPSLatitude: [[32, 1], [45, 1], [0, 1]], GPSLongitudeRef: 'E', GPSLongitude: [[129, 1], [52, 1], [0, 1]] },
          normalized: null, horizontalErrorMeters: null, datum: null, status: 'suspect', issues: [] }
          : index === 0 ? { rawTags: {}, normalized: { latitude: 32.75, longitude: 129.87 }, horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] }
            : { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
        gpsCorrection: null, sourceTime,
        timeCorrection: index === 5 ? { correctedLocalClock: '2026:01:04 08:00:00', correctedOffsetMinutes: null, correctedUtc: null,
          source: 'manual', correctedAt: trip.createdAt } : null,
        sourceOrientation: null, thumbnailId: thumbs[index] == null ? null : crypto.randomUUID(),
        thumbnailState: thumbs[index] == null ? 'failed' : 'available', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
      });
    });
    const thumbnails = photos.flatMap((photo, index) => {
      const shape = thumbs[index]; if (shape == null) return [];
      const blob = blobs[shape]!;
      return [{ id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg' as const, width: shapes[shape]![0]!, height: shapes[shape]![1]!, byteLength: blob.size, blob }];
    });
    await db.restoreNew({ trips: [trip], visits: [], photos, thumbnails }); db.close();
    return { tripId: trip.id, ids: photos.map(photo => photo.id) };
  }, withReference);
  await page.reload();
  await page.locator('#trip-select').selectOption(result.tripId);
  await expect(page.locator('#photo-count')).toContainText('6件');
  return result;
}

test('date grid, compact preview and folded advanced editing keep source uncertainty visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
  await expect(page.locator('#photo-list button')).toHaveCount(0);
  const { ids } = await seed(page);
  await expect(page.locator('#photo-list .photo-grid-date')).toContainText(['2026/01/04', '2026/01/03', '2026/01/02', '撮影日時不明']);
  await expect(page.locator('#photo-list .photo-grid-count')).toHaveText(['1枚', '1枚', '2枚', '2枚']);
  await expect(page.locator('#photo-list button')).toHaveCount(6);
  await expect(page.locator('#photo-list img')).toHaveCount(5);
  await expect(page.locator('#visits-layer-toggle')).not.toBeChecked();
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-desktop-grid.png' });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.locator('#header-left').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-desktop-900-grid.png' });
  await page.locator(`#photo-list button[data-photo-id="${ids[0]}"]`).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase-a3-desktop-900-preview.png' });
  await page.locator('#right-close').click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#header-left').click();

  await page.locator('#map-tools > summary').click();
  await page.locator('#map-zoom-out').click();
  await page.locator('#map-tools > summary').click();
  const zoomBefore = await page.locator('#map-zoom-level').textContent();
  await page.locator(`#photo-list button[data-photo-id="${ids[0]}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('縦長.jpg');
  await expect(page.locator('#photo-detail img')).toHaveCount(1);
  await expect(page.locator('#photo-advanced')).toHaveCount(0);
  await expect(page.locator('#map-zoom-level')).toHaveText(zoomBefore!);
  await page.waitForTimeout(250);
  const panel = await page.locator('#right-panel').evaluate(node => {
    const bounds = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { x: bounds.x, width: bounds.width, opacity: style.opacity, pointerEvents: style.pointerEvents };
  });
  expect(panel.x + panel.width).toBeLessThanOrEqual(1440);
  expect(panel.x).toBeGreaterThan(1000);
  expect(panel.width).toBeGreaterThan(300);
  expect(panel.opacity).toBe('1');
  expect(panel.pointerEvents).toBe('auto');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b2-prereq-desktop-preview.png' });
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-desktop-preview.png' });
  await page.getByRole('button', { name: '地図で見る' }).click();
  await expect(page.locator('#map-zoom-level')).not.toHaveText(zoomBefore!);
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await expect(page.locator('#photo-advanced')).not.toHaveAttribute('open', '');
  await page.locator('#photo-advanced > summary').click();
  await expect(page.locator('#gps-correction-latitude')).toBeVisible();
  await expect(page.locator('#photo-album-edit-open')).toBeVisible();
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-desktop-detail.png' });

  await page.locator(`#photo-list button[data-photo-id="${ids[4]}"]`).click();
  await expect(page.locator('#photo-detail')).toContainText('測地系不明の参考位置');
  await expect(page.getByRole('button', { name: '地図で見る' })).toHaveCount(0);
  await page.locator(`#photo-list button[data-photo-id="${ids[3]}"]`).click();
  await expect(page.locator('#photo-detail')).toContainText('撮影日時不明');
  await expect(page.locator('#photo-detail')).toContainText('再生成には原本写真を再選択');
  await page.locator('#right-close').click();
  await expect(page.locator(`#photo-list button[data-photo-id="${ids[3]}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'thumbnails') throw new Error('Synthetic read failure');
      return originalGet.call(this, key);
    };
  });
  await page.locator(`#photo-list button[data-photo-id="${ids[1]}"]`).click();
  await expect(page.locator('#photo-detail')).toContainText('サムネイルなし');
  await expect(page.locator('#photo-detail')).toContainText('撮影日時: 2026/01/02');
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-mode-visits').click();
  await page.reload();
  await expect(page.locator('#map-mode-visits')).toHaveAttribute('aria-pressed', 'true');
});

test('mobile map and photo tab show a bounded preview without losing the grid', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { ids } = await seed(page, false);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-mobile-map.png' });
  await page.locator('#map').click({ position: { x: 195, y: 415 } });
  await expect(page.locator('#photo-detail h3')).toHaveText('縦長.jpg');
  await expect(page.locator('body')).toHaveAttribute('data-photo-mode', 'preview');
  await page.waitForTimeout(250);
  const map = await page.locator('#map').boundingBox(), card = await page.locator('#right-panel').boundingBox();
  expect(map!.height).toBe(844);
  expect(card!.y + card!.height).toBeLessThan((await page.locator('#mobile-tabs').boundingBox())!.y + 1);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-mobile-map-preview.png' });
  await page.locator('#mobile-tab-photos').click();
  await expect(page.locator(`#photo-list button[data-photo-id="${ids[0]}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#photo-list button').first()).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-mobile-grid.png' });
  await page.locator(`#photo-list button[data-photo-id="${ids[0]}"]`).click();
  await expect(page.getByRole('button', { name: '詳細を見る' })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-mobile-preview.png' });
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await expect(page.locator('#photo-advanced')).toHaveCount(1);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-mobile-detail.png' });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('#photo-detail h3')).toHaveText('縦長.jpg');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5b1-mobile-320.png' });
  await page.getByRole('button', { name: 'プレビューに戻る' }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase-a3-mobile-320-preview.png' });
  await page.locator('#right-close').click();
  await page.screenshot({ path: 'test-results/phase-a-shots/phase-a3-mobile-320-grid.png' });
});

test('rapid photo selection keeps the current preview image after a delayed prior read', async ({ page }) => {
  const { ids } = await seed(page, false);
  const slowId = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const photo = (await db.listPhotos()).find(item => item.id === id)!; db.close(); return photo.thumbnailId!;
  }, ids[0]);
  await page.evaluate(async slowId => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const original = LibraryDb.prototype.getThumbnail;
    LibraryDb.prototype.getThumbnail = async function (id) {
      if (id === slowId) await new Promise(resolve => setTimeout(resolve, 220));
      return original.call(this, id);
    };
  }, slowId);
  await page.locator(`#photo-list button[data-photo-id="${ids[0]}"]`).click();
  await page.locator(`#photo-list button[data-photo-id="${ids[1]}"]`).click();
  await page.waitForTimeout(300);
  await expect(page.locator('#photo-detail h3')).toHaveText('横長.jpg');
  await expect(page.locator('#photo-detail img')).toHaveCount(1);
  const size = await page.locator('#photo-detail img').evaluate(image => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }));
  expect(size).toEqual({ width: 320, height: 240 });
});

test('gallery search, selection, preview and details remain usable by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { ids } = await seed(page, false);
  await page.locator('#photo-search').focus();
  await page.keyboard.type('縦長');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#photo-filter-clear').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#photo-list button')).toHaveCount(6);
  const tile = page.locator(`#photo-list button[data-photo-id="${ids[0]}"]`);
  await expect(tile).toHaveAttribute('aria-label', '縦長.jpg');
  await tile.focus();
  await page.keyboard.press('Enter');
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#photo-detail h3')).toHaveText('縦長.jpg');
  await page.getByRole('button', { name: '詳細を見る' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#photo-advanced')).toHaveCount(1);
});
