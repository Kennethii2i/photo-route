import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('12/24/48 MP JPEG imports, orientation and bounded thumbnails', async ({ page }) => {
  test.setTimeout(180_000);
  const external: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:5184/') && !request.url().startsWith('blob:http://127.0.0.1:5184/')) external.push(request.url());
  });
  await page.goto('/');
  for (const [name, expectedDimensions] of [
    ['jpeg_12mp_orientation6.jpg', [384, 512]],
    ['jpeg_24mp.jpg', [512, 341]],
    ['jpeg_48mp.jpg', [512, 384]],
  ] as const) {
    await page.locator('#photo-files').setInputFiles(`fixtures/camera/${name}`);
    const started = Date.now();
    await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
    await expect(page.locator('#import-status')).toContainText('成功 1件、部分成功 0件', { timeout: 120_000 });
    await expect(page.getByRole('button', { name: '選択した写真を取り込む' })).toBeEnabled();
    const elapsedMs = Date.now() - started;
    const snapshot = await page.evaluate(async () => {
      const storageUrl = '/src/infrastructure/storage.ts';
      const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
      const db = await LibraryDb.open();
      const photos = await db.listPhotos();
      const thumbs = await db.listThumbnails();
      db.close();
      let orientationTopRight: number[] | null = null;
      const oriented = photos.find(photo => photo.originalFilename === 'jpeg_12mp_orientation6.jpg');
      const orientedThumb = thumbs.find(thumb => thumb.photoId === oriented?.id);
      if (orientedThumb) {
        const bitmap = await createImageBitmap(orientedThumb.blob);
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
        orientationTopRight = Array.from(context.getImageData(bitmap.width - 8, 8, 1, 1).data);
        bitmap.close();
      }
      return { photos: photos.map(photo => ({ id: photo.id, name: photo.originalFilename, state: photo.thumbnailState, orientation: photo.sourceOrientation })),
        thumbs: thumbs.map(thumb => ({ photoId: thumb.photoId, width: thumb.width, height: thumb.height, bytes: thumb.byteLength })),
        orientationTopRight,
        jsHeapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null };
    });
    const photo = snapshot.photos.find(x => x.name === name);
    const thumb = snapshot.thumbs.find(x => x.photoId === photo?.id);
    expect(photo?.state).toBe('available');
    expect(snapshot.thumbs).toHaveLength(snapshot.photos.length);
    expect(snapshot.thumbs.map(x => [x.width, x.height])).toContainEqual(expectedDimensions);
    expect(thumb?.bytes).toBeLessThan(1024 * 1024);
    if (name.includes('orientation6')) expect(photo?.orientation).toBe(6);
    if (name.includes('orientation6')) {
      expect(snapshot.orientationTopRight?.[0]).toBeGreaterThan((snapshot.orientationTopRight?.[1] ?? 0) + 100);
      expect(snapshot.orientationTopRight?.[0]).toBeGreaterThan((snapshot.orientationTopRight?.[2] ?? 0) + 100);
    }
    console.log(JSON.stringify({ name, elapsedMs, jsHeapBytes: snapshot.jsHeapBytes, thumbnails: snapshot.thumbs.map(x => [x.width, x.height, x.bytes]) }));
  }
  await expect(page.locator('#photo-list button')).toHaveCount(3);
  expect(external).toEqual([]);
});

test('thumbnail decode failure is partial, malformed headers and truncated JPEG fail', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.createImageBitmap = async () => { throw new Error('検証用の復号失敗'); };
  });
  await page.locator('#photo-files').setInputFiles('fixtures/generated/jpeg_gps_offset_orientation6.jpg');
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#import-status')).toContainText('成功 0件、部分成功 1件');
  await expect(page.getByRole('button', { name: '選択した写真を取り込む' })).toBeEnabled();
  const original = readFileSync('fixtures/camera/jpeg_24mp.jpg');
  const badDimensions = Buffer.alloc(original.length);
  for (let i = 0; i < original.length; i++) badDimensions[i] = original[i]!;
  let sof = -1;
  for (let i = 0; i + 1 < badDimensions.length; i++) {
    if (badDimensions[i] === 0xff && badDimensions[i + 1] === 0xc0) { sof = i; break; }
  }
  expect(sof).toBeGreaterThan(0);
  badDimensions.writeUInt16BE(65535, sof + 5);
  badDimensions.writeUInt16BE(65535, sof + 7);
  await page.locator('#photo-files').setInputFiles([
    { name: 'bad-dimensions.jpg', mimeType: 'image/jpeg', buffer: badDimensions },
    { name: 'truncated.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_truncated.jpg') },
    { name: 'truncated-tail.jpg', mimeType: 'image/jpeg', buffer: original.subarray(0, original.length - 2) },
  ]);
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#import-status')).toContainText('失敗 3件');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  const stored = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const photos = await db.listPhotos();
    const thumbs = await db.listThumbnails();
    db.close();
    return { photos, thumbnailCount: thumbs.length };
  });
  expect(stored.photos).toHaveLength(1);
  expect(stored.thumbnailCount).toBe(0);
  expect(stored.photos[0]?.sourceGps.normalized).toEqual({ latitude: 35.5, longitude: 139.5 });
  expect(stored.photos[0]?.sourceTime.capturedAtUtc).toBe('2020-02-02T19:05:06.000Z');
  expect(stored.photos[0]?.sourceOrientation).toBe(6);
  expect(stored.photos[0]?.thumbnailState).toBe('failed');
});

test('80MP valid JPEG keeps metadata but avoids browser decode', async ({ page }) => {
  await page.goto('/');
  await page.locator('#photo-files').setInputFiles('fixtures/camera/jpeg_80mp_metadata_only.jpg');
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#import-status')).toContainText('成功 0件、部分成功 1件');
  await expect(page.locator('#import-results')).toContainText('サムネイル復号の安全上限を超えています');
  await expect(page.locator('#photo-list button')).toHaveCount(1);
});
