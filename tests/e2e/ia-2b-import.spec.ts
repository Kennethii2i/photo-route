import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync } from 'fflate';
import { seedUi } from './helpers/ui-package';
import { emptyLibrary, shot } from './helpers/ia-flows';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
const jpeg = 'fixtures/generated/jpeg_gps_offset_orientation6.jpg';
test('IA-2b rejects invalid targets before jobs and imports after creating the first live Trip', async ({ page }) => {
  await emptyLibrary(page);
  const rejected = await page.evaluate(async bytes => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const { PhotoImporter } = await import('../../src/application/import-photos'); const { newTrip } = await import('../../src/domain/model');
    const db = await LibraryDb.open(), deleted = { ...newTrip('合成ごみ箱旅行'), deletedAt: new Date().toISOString() }; await db.createTrip(deleted);
    const errors = [];
    for (const id of [null, crypto.randomUUID(), deleted.id]) {
      try { await new PhotoImporter(db).importFiles([new File([new Uint8Array(bytes)], 'synthetic.jpg', { type: 'image/jpeg' })], id); errors.push('unexpected-success'); }
      catch (error) { errors.push((error as Error).message); }
    }
    const result = { errors, jobs: (await db.listJobs()).length, photos: (await db.listPhotos()).length }; db.close(); return result;
  }, [...readFileSync(jpeg)]);
  expect(rejected.errors).toHaveLength(3); expect(rejected.errors).not.toContain('unexpected-success'); expect(rejected.jobs).toBe(0); expect(rejected.photos).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#header-add').click();
  await page.locator('#trip-name').fill('合成：最初の旅行'); await page.locator('#trip-create-submit').click();
  await expect(page.locator('#trip-create-status')).toContainText('作成しました'); await page.locator('#trip-create-submit').click();
  await page.locator('#photo-files').setInputFiles(jpeg); await page.locator('#import-button').click();
  await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'done');
  const trip = await page.locator('#trip-select').inputValue();
  expect(await page.evaluate(async trip => { const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const photos = await db.listPhotos(), jobs = await db.listJobs(); db.close(); return { valid: photos.length === 1 && photos[0]!.tripId === trip && photos[0]!.visitId === null, jobs: jobs.length }; }, trip)).toEqual({ valid: true, jobs: 1 });
});

test('IA-2b v1 unset Photo restores with corrections and remains browsable and exportable', async ({ page }) => {
  await seedUi(page);
  const fixture = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const { exportArchive } = await import('../../src/infrastructure/archive');
    const db = await LibraryDb.open(); const base = (await db.listPhotos())[0]!; db.close();
    const now = new Date().toISOString();
    const photo = { ...base, id: crypto.randomUUID(), tripId: null, originalFilename: '合成_旅行未設定.jpg', contentSha256: 'e'.repeat(64), thumbnailId: null, thumbnailState: 'failed' as const,
      gpsCorrection: { value: { latitude: 35.7, longitude: 139.2 }, correctedAt: now, source: 'manual' as const },
      timeCorrection: { correctedLocalClock: '2026:01:02 09:00:00', correctedOffsetMinutes: null, correctedUtc: null, correctedAt: now, source: 'manual' as const } };
    const blob = await exportArchive({ trips: [], visits: [], photos: [photo], links: [], thumbnails: [] });
    return { photo, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
  });
  const entries = unzipSync(new Uint8Array(fixture.bytes));
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as { version: number; entries: { path: string }[] };
  manifest.version = 1; manifest.entries = manifest.entries.filter(entry => entry.path !== 'records/photo-album-links.json'); delete entries['records/photo-album-links.json'];
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  await page.locator('#header-manage').click();
  await page.locator('#archive-file').setInputFiles({ name: 'synthetic-unset-v1.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)) }); await page.locator('#restore-button').click();
  await expect.poll(() => page.locator('#trip-select option[value=""]').textContent()).toContain('旅行未設定の写真');
  await page.locator('#management-close').click(); await page.locator('#trip-select').selectOption('');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#mobile-tab-photos').click();
  await expect(page.locator('#photo-count')).toHaveText('1件');
  await page.locator(`#photo-list [data-photo-id="${fixture.photo.id}"]`).click(); await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await page.locator('#photo-advanced > summary').click(); await expect(page.locator('#time-correction-clock')).toHaveValue('2026:01:02 09:00:00');
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('35.7');
  await page.locator('#gps-correction-latitude').fill('36'); await page.getByRole('button', { name: 'GPS補正を保存', exact: true }).click();
  await expect(page.locator('.photo-summary')).toContainText('手動補正');
  await page.locator('#right-close').click(); await page.locator('#header-add').click();
  await expect(page.locator('#import-trip-required')).toBeVisible(); await expect(page.locator('#import-selection')).toBeHidden(); await shot(page, 'ia2b-mobile390-trip-required');
  await page.setViewportSize({ width: 320, height: 740 }); await shot(page, 'ia2b-mobile320-trip-required');
  await page.locator('#import-close').click();
  const copied = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const { exportArchive, restoreArchive } = await import('../../src/infrastructure/archive');
    const db = await LibraryDb.open(), snapshot = await db.snapshot(); const target = await LibraryDb.open(`ia2b-v2-${crypto.randomUUID()}`);
    await restoreArchive(target, await exportArchive(snapshot)); const photo = (await target.listPhotos()).find(photo => photo.id === id)!; db.close(); target.close(); return photo;
  }, fixture.photo.id);
  expect(copied.tripId).toBeNull(); expect(copied.gpsCorrection?.value.latitude).toBe(36); expect(copied.timeCorrection).toEqual(fixture.photo.timeCorrection); expect(copied.sourceGps).toEqual(fixture.photo.sourceGps); expect(copied.sourceTime).toEqual(fixture.photo.sourceTime);
});

test('IA-2b required selection and running cancellation retain the captured Trip and saved Photo', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true });
  await page.reload(); await expect(page.locator('#trip-select')).toHaveValue(''); await page.locator('#header-add').click();
  await expect(page.locator('#import-trip-required')).toBeVisible(); await page.locator('#import-trip-choice').selectOption(ids.trip);
  await expect(page.locator('#import-selection')).toBeVisible();
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.savePhoto;
    LibraryDb.prototype.savePhoto = async function (...args) { const result = await original.apply(this, args); await new Promise<void>(resolve => { Object.assign(window, { __releaseSaved: resolve }); }); return result; };
  });
  await page.locator('#photo-files').setInputFiles([{ name: 'committed.jpg', mimeType: 'image/jpeg', buffer: readFileSync(jpeg) }, { name: 'unprocessed.png', mimeType: 'image/png', buffer: readFileSync('fixtures/generated/png_no_metadata.png') }]);
  await page.locator('#import-button').click(); await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __releaseSaved?: unknown }).__releaseSaved)).toBe('function');
  await page.locator('#import-close').click(); await page.locator('#trip-select').selectOption(ids.otherTrip!); await page.locator('#import-task').click();
  await expect(page.locator('#photo-import-trip')).toContainText('海辺の週末'); await page.locator('#cancel-button').click();
  await page.evaluate(() => (window as unknown as { __releaseSaved(): void }).__releaseSaved()); await expect(page.locator('#import-status')).toContainText('中断 1枚');
  const photos = await page.evaluate(async () => { const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open(); const photos = await db.listPhotos(); db.close(); return photos; });
  expect(photos.find(photo => photo.originalFilename === 'committed.jpg')?.tripId).toBe(ids.trip); expect(photos.some(photo => photo.originalFilename === 'unprocessed.png')).toBe(false);
});
