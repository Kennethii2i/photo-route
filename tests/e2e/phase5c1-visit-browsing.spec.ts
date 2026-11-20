import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function seed(page: Page) {
  const origin = test.info().project.use.baseURL as string;
  const external: string[] = [];
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : (external.push(route.request().url()), route.abort('blockedbyclient')));
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema, visitSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const { sourceClockEvidence } = await import('../../src/domain/time');
    const db = await LibraryDb.open(), trip = newTrip('合成Visit旅行');
    const a = newVisit(trip.id, '港への訪問', null, { latitude: 32.7, longitude: 129.8 });
    const b = newVisit(trip.id, '同時刻の別Visit', null, { latitude: 32.7, longitude: 129.8 });
    const c = newVisit(trip.id, '日時不明のVisit');
    const d = newVisit(trip.id, '先週のVisit');
    const clock = '2026-01-02T09:00:00.000Z';
    const names = ['A-早朝.jpg', 'A-昼.jpg', 'A-夕方.jpg', 'A-遠方.jpg', 'A-GPSなし.jpg', 'unrelated.jpg', 'C-参考位置.jpg'];
    const owners = [a.id, a.id, a.id, a.id, a.id, c.id, c.id];
    const coordinates: ([number, number] | null)[] = [[32.7, 129.8], [32.701, 129.8], [32.702, 129.8], [40, 140], null, [32.7, 129.8], [32.71, 129.81]];
    const thumbs = [true, true, false, true, false, true, true];
    const photos = names.map((name, index) => {
      const rawDateTimeOriginal = index === 6 ? null : `2026:01:0${index + 1} 10:00:00`;
      const location = coordinates[index];
      const sourceGps = index === 6 ? { rawTags: { GPSLatitudeRef: 'N', GPSLatitude: [[32, 1], [42, 1], [36, 1]], GPSLongitudeRef: 'E', GPSLongitude: [[129, 1], [48, 1], [36, 1]] },
        normalized: null, horizontalErrorMeters: 2, datum: null, status: 'suspect' as const, issues: [] }
        : location ? { rawTags: {}, normalized: { latitude: location[0], longitude: location[1] }, horizontalErrorMeters: null,
          datum: 'WGS-84', status: 'valid' as const, issues: [] }
          : { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing' as const, issues: [] };
      return photoSchema.parse({ id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: name,
        sourceMime: 'image/jpeg', sourceByteLength: 2_000_000, contentSha256: index.toString(16).padStart(64, '0'), sourceGps,
        gpsCorrection: null, sourceTime: { ...sourceClockEvidence(rawDateTimeOriginal, null), rawDateTimeOriginal,
          rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] }, timeCorrection: null,
        sourceOrientation: null, thumbnailId: thumbs[index] ? crypto.randomUUID() : null,
        thumbnailState: thumbs[index] ? 'available' : 'failed', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null });
    });
    const visits = [
      visitSchema.parse({ ...a, representativePhotoId: photos[5]!.id, locationSource: 'selected-photo', userStartAtUtc: clock }),
      visitSchema.parse({ ...b, userStartAtUtc: clock }),
      c,
      visitSchema.parse({ ...d, userStartAtUtc: '2026-01-01T09:00:00.000Z' }),
    ];
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192;
    const context = canvas.getContext('2d')!;
    const scene = async (index: number) => {
      const sky = context.createLinearGradient(0, 0, 0, 192);
      sky.addColorStop(0, ['#88bfd2', '#f5aa79', '#bedab9', '#aec5d5'][index % 4]!);
      sky.addColorStop(1, ['#e2e8dc', '#795c6b', '#507253', '#e8c6a3'][index % 4]!);
      context.fillStyle = sky; context.fillRect(0, 0, 256, 192);
      if (index % 4 === 0) {
        context.fillStyle = '#2e8290'; context.fillRect(0, 94, 256, 98);
        context.fillStyle = '#e9e8d9'; context.fillRect(174, 58, 14, 91);
        context.beginPath(); context.moveTo(163, 60); context.lineTo(195, 60); context.lineTo(180, 31); context.fill();
      } else if (index % 4 === 1) {
        context.fillStyle = '#705e57'; context.fillRect(0, 143, 256, 49);
        for (let x = 12; x < 250; x += 57) { context.fillStyle = '#b68463'; context.fillRect(x, 73 - x % 23, 43, 85); context.fillStyle = '#ffdb9c'; for (let y = 88; y < 137; y += 22) context.fillRect(x + 9, y, 7, 10); }
      } else if (index % 4 === 2) {
        context.fillStyle = '#658b60'; context.fillRect(0, 148, 256, 44);
        for (let x = 25; x < 255; x += 55) { context.fillStyle = '#69583e'; context.fillRect(x, 72, 11, 87); context.fillStyle = '#35764e'; context.beginPath(); context.arc(x + 5, 72, 37, 0, Math.PI * 2); context.fill(); }
      } else {
        context.fillStyle = '#a3734e'; context.fillRect(0, 126, 256, 66);
        context.fillStyle = '#f2dfbb'; context.beginPath(); context.ellipse(128, 124, 88, 46, 0, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#bc613c'; context.beginPath(); context.ellipse(128, 124, 62, 30, 0, 0, Math.PI * 2); context.fill();
      }
      return new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .86));
    };
    const thumbnails = [];
    for (const [index, photo] of photos.entries()) {
      if (!photo.thumbnailId) continue;
      const blob = await scene(index);
      thumbnails.push({ id: photo.thumbnailId, photoId: photo.id,
        mime: 'image/jpeg' as const, width: 256, height: 192, byteLength: blob.size, blob });
    }
    const links = photos.map((photo, index) => ({ photoId: photo.id, albumId: owners[index]!, createdAt: null }));
    await db.restoreNew({ trips: [trip], visits, photos, thumbnails, links }); db.close();
    return { tripId: trip.id, visitIds: visits.map(visit => visit.id), photoIds: photos.map(photo => photo.id) };
  });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.tripId);
  return { ...ids, external };
}

test('album list and overview visual comparison at desktop and mobile widths', async ({ page }) => {
  const stage = process.env.PHASE_A4_STAGE === 'before' ? 'before' : 'after';
  const folder = `test-results/phase-a4-screenshots/${stage}`;
  mkdirSync(folder, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const { tripId, visitIds, external } = await seed(page);
  await page.locator('#left-tab-visits').click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${folder}/desktop-1440-list.png` });
  await page.locator(`#visit-list button[data-visit-id="${visitIds[0]}"]`).click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${folder}/desktop-1440-overview.png` });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${folder}/desktop-900-overview.png` });
  await page.locator('#right-close').click();
  await page.locator('#header-left').click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${folder}/desktop-900-list.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-tab-visits').click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${folder}/mobile-390-list.png` });
  await page.locator(`#visit-list button[data-visit-id="${visitIds[0]}"]`).click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${folder}/mobile-390-overview.png` });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${folder}/mobile-320-overview.png` });
  await page.locator('#right-close').click();
  await page.screenshot({ path: `${folder}/mobile-320-list.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#trip-select')).toHaveValue(tripId);
  expect(external).toEqual([]);
});

test('desktop Visit list and summary separate membership, time and editing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { visitIds, photoIds, external } = await seed(page);
  await page.locator('#left-tab-visits').click();
  await expect(page.locator('#visit-list .visit-date-heading')).toContainText(['2026/01/01 UTC', '2026/01/02 UTC', '設定日時なし']);
  await expect(page.locator('#visit-list button')).toHaveCount(4);
  await expect(page.locator('#visit-list button').nth(0)).toContainText('先週のVisit');
  await expect(page.locator('#visit-list button').nth(3)).toContainText('日時不明のVisit');
  await expect(page.locator('#visit-list button').filter({ hasText: '港への訪問' })).toHaveCount(1);
  await expect(page.locator('#visit-list button').filter({ hasText: '同時刻の別Visit' })).toHaveCount(1);
  const albumCard = page.locator(`#visit-list button[data-visit-id="${visitIds[0]}"]`);
  await expect(albumCard).toContainText('撮影 2026/01/01 〜 2026/01/05');
  await expect(albumCard.locator('.visit-list-cover img')).toBeVisible();
  await expect(page.locator(`#visit-list button[data-visit-id="${visitIds[1]}"] .visit-list-cover`)).toHaveText('写真なし');
  await page.locator(`#visit-list button[data-visit-id="${visitIds[0]}"]`).click();
  await expect(page.locator('#visit-summary')).toBeVisible();
  await expect(page.locator('#visit-form')).toBeHidden();
  await expect(page.locator('#visit-summary')).toContainText('写真 5枚');
  await expect(page.locator('#visit-summary')).toContainText('緯度 32.7、経度 129.8');
  await expect(page.locator('#visit-summary button[aria-label$="のプレビュー"]')).toHaveCount(3);
  await expect(page.locator('#visit-summary .visit-summary-cover')).toHaveAttribute('aria-label', 'A-早朝.jpg のプレビュー');
  await expect(page.locator('#visit-summary .visit-summary-cover img')).toBeVisible();
  await expect(page.locator('#visit-summary')).not.toContainText('unrelated.jpg');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5c1-desktop-summary.png' });
  await page.getByRole('button', { name: '写真を見る' }).click();
  await expect(page.locator('#visit-all-count')).toContainText('5枚');
  await expect(page.locator('#visit-all-photo-list button').first()).toBeVisible();
  await page.locator('#right-panel').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  await expect(page.locator(`#visit-all-photo-list button[data-photo-id="${photoIds[4]}"]`)).toBeVisible();
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5c1-desktop-all-photos.png' });
  await page.locator(`#visit-all-photo-list button[data-photo-id="${photoIds[4]}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('A-GPSなし.jpg');
  await page.locator('#right-close').click();
  await expect(page.locator('#visit-summary')).toBeVisible();
  await expect(page.locator(`#visit-list button[data-visit-id="${visitIds[0]}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await expect(page.locator('#visit-form')).toBeVisible();
  await page.locator('#visit-label').fill('未保存の名前');
  page.once('dialog', dialog => { void dialog.dismiss(); });
  await page.locator('#visit-edit-back').click();
  await expect(page.locator('#visit-label')).toHaveValue('未保存の名前');
  page.once('dialog', dialog => { void dialog.accept(); });
  await page.locator('#visit-edit-back').click();
  await expect(page.locator('#visit-summary')).toBeVisible();
  await expect(page.locator('#visit-summary')).toContainText('港への訪問');
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5c1-desktop-edit.png' });
  await page.locator(`#visit-list button[data-visit-id="${visitIds[1]}"]`).click();
  await expect(page.locator('#visit-summary')).toContainText('写真 0枚');
  await expect(page.locator('#visit-summary')).toContainText('このアルバムに写真はありません');
  await page.locator(`#visit-list button[data-visit-id="${visitIds[2]}"]`).click();
  await expect(page.locator('#visit-summary')).toContainText('設定日時なし');
  await expect(page.locator('#visit-summary')).toContainText('代表位置なし');
  expect(external).toEqual([]);
});

test('album list thumbnail URLs are released when the selected trip changes', async ({ page }) => {
  const { external } = await seed(page);
  await page.locator('#left-tab-visits').click();
  const image = page.locator('#visit-list .visit-list-cover img').first();
  await expect(image).toBeVisible();
  const url = await image.getAttribute('src');
  expect(url).toMatch(/^blob:/);
  await page.locator('#trip-select').selectOption('');
  await expect(page.locator('#visit-list button')).toHaveCount(0);
  const released = await page.evaluate(async value => {
    try { await fetch(value!); return false; } catch { return true; }
  }, url);
  expect(released).toBe(true);
  expect(external).toEqual([]);
});

test('album cards and overview keep a usable placeholder when thumbnail reads fail', async ({ page }) => {
  const { tripId, visitIds, external } = await seed(page);
  await page.evaluate(() => {
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'thumbnails') throw new Error('Synthetic thumbnail read failure');
      return originalGet.call(this, key);
    };
  });
  await page.locator('#trip-select').selectOption('');
  await expect(page.locator('#visit-list button')).toHaveCount(0);
  await page.locator('#trip-select').selectOption(tripId);
  await expect(page.locator('#visit-list button')).toHaveCount(4);
  await page.locator('#left-tab-visits').click();
  const card = page.locator(`#visit-list button[data-visit-id="${visitIds[0]}"]`);
  await expect(card.locator('.visit-list-cover')).toHaveText('画像なし');
  await card.click();
  await expect(page.locator('#visit-summary .visit-summary-cover')).toHaveText('画像なし');
  await expect(page.locator('#visit-summary')).toContainText('写真 5枚');
  await expect(page.locator('#visit-summary').getByRole('button', { name: '写真を見る' })).toBeVisible();
  expect(external).toEqual([]);
});

test('Visit map focus temporarily includes hidden linked photos and restores search and mode', async ({ page }) => {
  const { visitIds, external } = await seed(page);
  await page.locator('#photo-search').fill('unrelated');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-mode-visits').click();
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${visitIds[0]}"]`).click();
  await page.getByRole('button', { name: '地図で見る' }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await expect(page.locator('#visit-focus-message')).toContainText('位置あり4枚 / 所属5枚');
  await expect(page.locator('#photo-search')).toHaveValue('unrelated');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await expect(page.locator('#map-marker-count')).toContainText('5地点');
  await expect.poll(() => page.locator('.map-photo-thumb.is-visit-focused').count()).toBeGreaterThan(0);
  await expect(page.locator('.map-photo-thumb-count').filter({ hasText: '2' }).locator('..')).not.toHaveClass(/is-visit-focused/);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5c1-desktop-focus.png' });
  await page.locator('#visit-focus-all').click();
  await expect(page.locator('#map-zoom-level')).toContainText('ズーム:');
  await page.locator('#visit-focus-exit').click();
  await expect(page.locator('#visit-summary')).toBeVisible();
  await expect(page.locator('#map-mode-visits')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#photo-search')).toHaveValue('unrelated');
  await expect(page.locator('#map-marker-count')).toContainText('2地点');
  await page.locator(`#visit-list button[data-visit-id="${visitIds[1]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '地図で見る' }).click();
  await expect(page.locator('#visit-focus-message')).toContainText('位置あり0枚 / 所属0枚');
  await page.locator('#visit-focus-exit').click();
  await page.locator(`#visit-list button[data-visit-id="${visitIds[2]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '地図で見る' }).click();
  await expect(page.locator('#visit-focus-message')).toContainText('位置あり2枚 / 所属2枚');
  await expect(page.locator('#map-status')).toContainText('測地系不明の参考位置');
  await page.locator(`#visit-list button[data-visit-id="${visitIds[1]}"]`).click();
  await expect(page.locator('#visit-focus-banner')).toBeHidden();
  await expect(page.locator('#map-mode-visits')).toHaveAttribute('aria-pressed', 'true');
  expect(external).toEqual([]);
});

test('mobile Visit summary, map focus and return fit 390px and 320px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { visitIds } = await seed(page);
  await page.locator('#mobile-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${visitIds[0]}"]`).click();
  await expect(page.locator('#visit-summary')).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5c1-mobile-summary.png' });
  await page.getByRole('button', { name: '地図で見る' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'map');
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  const tabs = await page.locator('#mobile-tabs').boundingBox(), banner = await page.locator('#visit-focus-banner').boundingBox();
  expect(banner!.y + banner!.height).toBeLessThan(tabs!.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5c1-mobile-focus.png' });
  await page.locator('#visit-focus-exit').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'visits');
  await expect(page.locator('#visit-summary')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/phase-a-shots/phase5c1-mobile-320-summary.png' });
});
