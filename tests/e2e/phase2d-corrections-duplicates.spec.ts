import { expect, test } from '@playwright/test';

const fixture = 'fixtures/generated/jpeg_gps_offset_orientation6.jpg';
const openPhotoEditing = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-advanced > summary').click();
};

test('manual GPS and time corrections preserve Exif, support revert and survive ZIP restore', async ({ page, browser }) => {
  await page.goto('/');
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles(fixture);
  await page.locator('#import-button').click();
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#photo-list button').click();
  await openPhotoEditing(page);
  const initial = await page.evaluate(async () => {
    const url = '/src/infrastructure/storage.ts'; const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const photo = (await db.listPhotos())[0]!; db.close(); return photo;
  });
  await page.locator('#gps-correction-latitude').fill('0');
  await page.locator('#gps-correction-longitude').fill('0');
  await page.getByRole('button', { name: 'GPS補正を保存' }).click();
  await expect(page.locator('#photo-detail')).toContainText('0, 0（手動WGS84補正）');
  await page.locator('#gps-correction-latitude').fill('91');
  await page.getByRole('button', { name: 'GPS補正を保存' }).click();
  await expect(page.locator('#photo-detail')).toContainText('GPS補正を保存できません');
  await page.locator('#gps-correction-latitude').fill('0');
  await page.locator('#time-correction-clock').fill('2026:01:02 03:04:05');
  await page.getByRole('button', { name: '撮影日時補正を保存' }).click();
  await expect(page.locator('#photo-detail')).toContainText('UTC 未確定');
  await page.locator('#time-correction-offset').fill('+09:00');
  await page.getByRole('button', { name: '撮影日時補正を保存' }).click();
  await expect(page.locator('#photo-detail')).toContainText('2026-01-01T18:04:05.000Z');
  await page.reload(); await page.locator('#photo-list button').click(); await openPhotoEditing(page);
  await expect(page.locator('#photo-detail')).toContainText('0, 0（手動WGS84補正）');
  const after = await page.evaluate(async () => {
    const url = '/src/infrastructure/storage.ts'; const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const photo = (await db.listPhotos())[0]!; db.close(); return photo;
  });
  expect(after.id).toBe(initial.id);
  expect(after.sourceGps).toEqual(initial.sourceGps);
  expect(after.sourceTime).toEqual(initial.sourceTime);
  expect(after.thumbnailId).toBe(initial.thumbnailId);
  expect(after.gpsCorrection?.value).toEqual({ latitude: 0, longitude: 0 });
  await page.locator('#header-manage').click();
  await page.locator('#manage-archive').click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-button').click();
  const downloaded = await downloadPromise; const zip = await (await import('node:fs/promises')).readFile(await downloaded.path());
  const fresh = await browser.newContext();
  try {
    const target = await fresh.newPage(); await target.goto('/');
    await target.locator('#header-manage').click();
    await target.locator('#manage-archive').click();
    await target.locator('#archive-file').setInputFiles({ name: 'corrections.zip', mimeType: 'application/zip', buffer: zip });
    await target.locator('#restore-button').click();
    await target.locator('#management-close').click();
    await expect(target.locator('#photo-list button')).toHaveCount(1);
    await target.locator('#photo-list button').click();
    await openPhotoEditing(target);
    await expect(target.locator('#photo-detail')).toContainText('0, 0（手動WGS84補正）');
    const restored = await target.evaluate(async () => {
      const url = '/src/infrastructure/storage.ts'; const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
      const db = await LibraryDb.open(); const photo = (await db.listPhotos())[0]!; db.close(); return photo;
    });
    expect(restored.sourceGps).toEqual(initial.sourceGps);
    expect(restored.sourceTime).toEqual(initial.sourceTime);
    expect(restored.gpsCorrection).toEqual(after.gpsCorrection);
    expect(restored.timeCorrection).toEqual(after.timeCorrection);
  } finally { await fresh.close(); }
  await page.locator('#management-close').click();
  await page.getByRole('button', { name: 'GPS補正を解除' }).click();
  await expect(page.locator('#photo-detail')).toContainText('表示位置: 元GPSを使用');
  await page.getByRole('button', { name: '撮影日時補正を解除' }).click();
  await expect(page.locator('#photo-detail')).toContainText('手動撮影日時: なし');
  await page.locator('#header-manage').click();
  await page.locator('#manage-recovery').click();
  await page.locator('#undo-button').click();
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-detail')).toContainText('2026-01-01T18:04:05.000Z');
});

test('duplicate exception creates a distinct Photo only in a different Trip', async ({ page, browser }) => {
  await page.goto('/');
  await page.locator('#header-manage').click();
  await page.locator('#trip-name').fill('A'); await page.getByRole('button', { name: '旅行を作成' }).click();
  await page.locator('#manage-import').click();
  await page.locator('#photo-files').setInputFiles(fixture); await page.locator('#import-button').click();
  await expect(page.locator('#import-status')).toContainText('成功 1件');
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#photo-list button').click();
  await openPhotoEditing(page);
  await page.locator('#gps-correction-latitude').fill('0'); await page.locator('#gps-correction-longitude').fill('0');
  await page.getByRole('button', { name: 'GPS補正を保存' }).click();
  await page.locator('#header-manage').click();
  await page.locator('#trip-name').fill('B'); await page.getByRole('button', { name: '旅行を作成' }).click();
  await page.locator('#manage-import').click();
  await page.locator('#photo-files').setInputFiles(fixture); await page.locator('#import-button').click();
  await expect(page.locator('#import-status')).toContainText('重複スキップ 1件');
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-list button')).toHaveCount(0);
  await page.locator('#header-add').click();
  await page.locator('#duplicate-other-trip').check();
  await page.locator('#photo-files').setInputFiles(fixture); await page.locator('#import-button').click();
  await expect(page.locator('#import-results')).toContainText('別の旅行へ重複写真として追加');
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  const state = await page.evaluate(async () => {
    const url = '/src/infrastructure/storage.ts'; const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const photos = await db.listPhotos(); db.close();
    return photos.map(photo => ({ id: photo.id, tripId: photo.tripId, hash: photo.contentSha256, correction: photo.gpsCorrection }));
  });
  expect(state).toHaveLength(2);
  expect(state[0]?.id).not.toBe(state[1]?.id);
  expect(state[0]?.tripId).not.toBe(state[1]?.tripId);
  expect(state[0]?.hash).toBe(state[1]?.hash);
  expect(state.filter(photo => photo.correction !== null)).toHaveLength(1);
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles(fixture); await page.locator('#import-button').click();
  await expect(page.locator('#import-status')).toContainText('重複スキップ 1件');
  expect(await page.evaluate(async () => { const url = '/src/infrastructure/storage.ts'; const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const count = (await db.listPhotos()).length; db.close(); return count; })).toBe(2);
  await page.locator('#manage-archive').click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-button').click();
  const downloaded = await downloadPromise; const zip = await (await import('node:fs/promises')).readFile(await downloaded.path());
  const fresh = await browser.newContext();
  try {
    const target = await fresh.newPage(); await target.goto('/');
    await target.locator('#header-manage').click();
    await target.locator('#manage-archive').click();
    await target.locator('#archive-file').setInputFiles({ name: 'duplicates.zip', mimeType: 'application/zip', buffer: zip });
    await target.locator('#restore-button').click();
    await expect(target.locator('#archive-status')).toContainText('2件の旅行と2件の写真を復元');
    const restored = await target.evaluate(async () => {
      const url = '/src/infrastructure/storage.ts'; const { LibraryDb } = await import(url) as typeof import('../../src/infrastructure/storage');
      const db = await LibraryDb.open(); const photos = await db.listPhotos(); db.close();
      return photos.map(photo => ({ id: photo.id, tripId: photo.tripId, hash: photo.contentSha256, correction: photo.gpsCorrection }));
    });
    expect(restored).toEqual(state);
  } finally { await fresh.close(); }
});

test('a failed recovery snapshot rolls back a manual correction', async ({ page }) => {
  await page.goto('/');
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles(fixture); await page.locator('#import-button').click();
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  const result = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts', correctionUrl = '/src/domain/corrections.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { manualGpsCorrection } = await import(correctionUrl) as typeof import('../../src/domain/corrections');
    const db = await LibraryDb.open(); const before = (await db.listPhotos())[0]!;
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
      if (this.name === 'recovery') throw new DOMException('quota', 'QuotaExceededError');
      return add.call(this, value, key);
    };
    let failed = false;
    try { await db.updatePhotoCorrection(before.id, { gpsCorrection: manualGpsCorrection(0, 0) }); }
    catch { failed = true; }
    finally { IDBObjectStore.prototype.add = add; }
    const after = (await db.listPhotos())[0]!; const history = await db.listRecovery(); db.close();
    return { failed, unchanged: JSON.stringify(before) === JSON.stringify(after), history: history.length };
  });
  expect(result).toEqual({ failed: true, unchanged: true, history: 0 });
});

test('storage rechecks duplicate hashes atomically before a new Photo is saved', async ({ page }) => {
  await page.goto('/');
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles(fixture); await page.locator('#import-button').click();
  await page.locator('#management-close').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  const result = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts', modelUrl = '/src/domain/model.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import(modelUrl) as typeof import('../../src/domain/model');
    const db = await LibraryDb.open(), existing = (await db.listPhotos())[0]!;
    const trip = newTrip('Different trip'); await db.createTrip(trip);
    const copy = photoSchema.parse({ ...existing, id: crypto.randomUUID(), tripId: trip.id, visitId: null,
      thumbnailId: null, thumbnailState: 'failed', gpsCorrection: null, timeCorrection: null });
    let defaultRejected = false, sameTripRejected = false;
    try { await db.savePhoto(copy, null); } catch { defaultRejected = true; }
    try { await db.savePhoto({ ...copy, id: crypto.randomUUID(), tripId: existing.tripId }, null, { allowDuplicateAcrossTrips: true }); }
    catch { sameTripRejected = true; }
    const afterRefusals = (await db.listPhotos()).length;
    await db.savePhoto(copy, null, { allowDuplicateAcrossTrips: true });
    const final = await db.listPhotos(); db.close();
    return { defaultRejected, sameTripRejected, afterRefusals, finalCount: final.length,
      sourceUnchanged: final.find(photo => photo.id === existing.id)?.updatedAt === existing.updatedAt };
  });
  expect(result).toEqual({ defaultRejected: true, sameTripRejected: true, afterRefusals: 1, finalCount: 2, sourceUnchanged: true });
});
