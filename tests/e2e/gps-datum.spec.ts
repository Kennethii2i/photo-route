import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('saved legacy Photo gains a labeled reference map point without any record rewrite', async ({ page }) => {
  await page.goto('/');
  const bytes = Array.from(readFileSync('fixtures/generated/jpeg_gps_no_datum.jpg'));
  const before = await page.evaluate(async data => {
    const modelUrl = '/src/domain/model.ts', imageUrl = '/src/infrastructure/image.ts', storageUrl = '/src/infrastructure/storage.ts';
    const { newTrip, photoSchema } = await import(modelUrl) as typeof import('../../src/domain/model');
    const { parseMetadata, makeThumbnail, sha256 } = await import(imageUrl) as typeof import('../../src/infrastructure/image');
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const trip = newTrip('Legacy GPS trip'); await db.createTrip(trip);
    const source = new Uint8Array(data);
    const metadata = await parseMetadata(source);
    const id = crypto.randomUUID();
    const thumbnail = await makeThumbnail(source, 'image/jpeg', id, metadata.sourceOrientation);
    const photo = photoSchema.parse({ id, tripId: trip.id, visitId: null, originalFilename: 'legacy.jpg', sourceMime: 'image/jpeg', sourceByteLength: source.length,
      contentSha256: await sha256(source), ...metadata,
      sourceGps: { ...metadata.sourceGps, issues: ['WGS84以外の測地系です。座標を地図に投影しません'] },
      gpsCorrection: null, timeCorrection: null, thumbnailId: thumbnail.id, thumbnailState: 'available',
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null });
    await db.savePhoto(photo, thumbnail);
    const thumbHash = await sha256(new Uint8Array(await thumbnail.blob.arrayBuffer()));
    db.close();
    return { photoJson: JSON.stringify(photo), thumbHash, tripId: trip.id };
  }, bytes);
  await page.reload();
  await page.locator('#trip-select').selectOption(before.tripId);
  await expect(page.locator('#photo-list button')).toHaveAttribute('aria-label', 'legacy.jpg');
  await expect(page.locator('#map-status')).toContainText('測地系不明の参考位置');
  await page.locator('#photo-list button').click();
  await expect(page.locator('#photo-detail')).toContainText('測地系不明の参考位置');
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-advanced > summary').click();
  await expect(page.locator('#photo-detail')).toContainText('参考位置・測地系不明');
  await expect(page.locator('#photo-detail')).toContainText('GPS水平誤差: 7.5 m');
  await expect(page.locator('#photo-detail')).not.toContainText('WGS84以外の測地系です。座標を地図に投影しません');
  const after = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts', mapUrl = '/src/domain/map.ts', imageUrl = '/src/infrastructure/image.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { photoPoints } = await import(mapUrl) as typeof import('../../src/domain/map');
    const { sha256 } = await import(imageUrl) as typeof import('../../src/infrastructure/image');
    const db = await LibraryDb.open();
    const photos = await db.listPhotos();
    const thumbs = await db.listThumbnails();
    const features = photoPoints(photos).features;
    const thumbHash = await sha256(new Uint8Array(await thumbs[0]!.blob.arrayBuffer()));
    db.close();
    return { photoJson: JSON.stringify(photos[0]), thumbHash, thumbnailCount: thumbs.length,
      featureCount: features.length, gpsState: features[0]?.properties.gpsState };
  });
  expect(after.photoJson).toBe(before.photoJson);
  expect(after.thumbHash).toBe(before.thumbHash);
  expect(after.thumbnailCount).toBe(1);
  expect(after.featureCount).toBe(1);
  expect(after.gpsState).toBe('datum-unknown-reference');
});

test('missing datum is shown as reference while explicit non-WGS84 and invalid GPS stay off the map', async ({ page }) => {
  await page.goto('/');
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles([
    'fixtures/generated/jpeg_gps_offset_orientation6.jpg',
    'fixtures/generated/jpeg_gps_no_datum.jpg',
    'fixtures/generated/jpeg_gps_non_wgs84.jpg',
    'fixtures/generated/jpeg_gps_southwest_no_datum.jpg',
    'fixtures/generated/jpeg_zero_zero_no_datum.jpg',
    'fixtures/generated/jpeg_invalid_gps.jpg',
  ]);
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#import-status')).toContainText('6/6件を処理（completed）');
  await page.locator('#management-close').click();
  await page.locator('#photo-list button[aria-label="jpeg_gps_non_wgs84.jpg"]').click();
  await expect(page.locator('#photo-detail')).toContainText('非WGS84のため表示不可');
  await page.locator('#photo-list button[aria-label="jpeg_invalid_gps.jpg"]').click();
  await expect(page.locator('#photo-detail')).toContainText('無効なGPS値');
  const result = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts', mapUrl = '/src/domain/map.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { photoPoints } = await import(mapUrl) as typeof import('../../src/domain/map');
    const db = await LibraryDb.open();
    const photos = await db.listPhotos();
    db.close();
    return { photos: photos.map(x => ({ name: x.originalFilename, status: x.sourceGps.status, datum: x.sourceGps.datum, normalized: x.sourceGps.normalized })), features: photoPoints(photos).features };
  });
  expect(result.photos).toHaveLength(6);
  expect(result.features).toHaveLength(4);
  expect(result.features.filter(x => x.properties.gpsState === 'datum-unknown-reference')).toHaveLength(3);
  expect(result.features.some(x => x.geometry.coordinates[0] === 0 && x.geometry.coordinates[1] === 0)).toBe(true);
  expect(result.features.some(x => x.geometry.coordinates[0] === -139.5 && x.geometry.coordinates[1] === -35.5)).toBe(true);
  expect(result.photos.find(x => x.name === 'jpeg_gps_no_datum.jpg')).toMatchObject({ status: 'suspect', datum: null, normalized: null });
  expect(result.photos.find(x => x.name === 'jpeg_gps_non_wgs84.jpg')).toMatchObject({ status: 'suspect', datum: 'TOKYO', normalized: null });
  expect(result.photos.find(x => x.name === 'jpeg_invalid_gps.jpg')?.status).toBe('invalid');
});

test('optional private ten-photo GPS projection and persistence smoke', async ({ page }) => {
  test.skip(!process.env.PHOTO_PROBE_DIR, 'Set PHOTO_PROBE_DIR to the local JPEG folder');
  test.setTimeout(180_000);
  const files = readdirSync(process.env.PHOTO_PROBE_DIR!).filter(name => /\.jpe?g$/i.test(name)).sort().map(name => join(process.env.PHOTO_PROBE_DIR!, name)).filter(path => statSync(path).isFile());
  expect(files).toHaveLength(10);
  const external: string[] = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:5184/') || url.startsWith('blob:http://127.0.0.1:5184/')) void route.continue();
    else { external.push(url); void route.abort(); }
  });
  await page.goto('/');
  await page.locator('#photo-files').setInputFiles(files);
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#import-status')).toContainText('10/10件を処理（completed）', { timeout: 120_000 });
  await expect(page.locator('#map-status')).toContainText('測地系不明の参考位置');
  await expect(page.locator('#photo-list button')).toHaveCount(10);
  const inspect = async () => page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts', mapUrl = '/src/domain/map.ts', imageUrl = '/src/infrastructure/image.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const { photoPoints } = await import(mapUrl) as typeof import('../../src/domain/map');
    const { sha256 } = await import(imageUrl) as typeof import('../../src/infrastructure/image');
    const db = await LibraryDb.open();
    const photos = await db.listPhotos();
    const thumbnails = await db.listThumbnails();
    db.close();
    const rawComplete = photos.filter(x => Array.isArray(x.sourceGps.rawTags.GPSLatitude) && Array.isArray(x.sourceGps.rawTags.GPSLongitude) && x.sourceGps.rawTags.GPSLatitudeRef != null && x.sourceGps.rawTags.GPSLongitudeRef != null).length;
    const features = photoPoints(photos).features;
    const fingerprint = await sha256(new TextEncoder().encode(JSON.stringify(photos)));
    return { photoCount: photos.length, thumbnailCount: thumbnails.length, rawComplete, unknownDatumCount: photos.filter(x => x.sourceGps.datum === null && x.sourceGps.normalized === null && x.sourceGps.status === 'suspect').length,
      accuracyCount: photos.filter(x => x.sourceGps.horizontalErrorMeters !== null).length,
      mapPointCount: features.length, referenceCount: features.filter(x => x.properties.gpsState === 'datum-unknown-reference').length, fingerprint };
  });
  const before = await inspect();
  await page.reload();
  await expect(page.locator('#photo-list button')).toHaveCount(10);
  await expect(page.locator('#map-status')).toContainText('測地系不明の参考位置');
  const after = await inspect();
  expect(before).toMatchObject({ photoCount: 10, thumbnailCount: 10, rawComplete: 10, unknownDatumCount: 10, accuracyCount: 10, mapPointCount: 10, referenceCount: 10 });
  expect(after).toEqual(before);
  expect(external).toEqual([]);
  console.log('private GPS smoke: ten raw coordinates retained, ten reference map points, unchanged after reload, zero external requests');
});
