import { readFileSync } from 'node:fs';
import ExifReader from 'exifreader';
import { expect, test } from '@playwright/test';

test('P1 thumbnails apply raw EXIF orientation once and strip GPS/time metadata', async ({ page }) => {
  await page.goto('/');
  for (const [path, mime, orientation] of [
    ['fixtures/generated/jpeg_gps_offset_orientation6.jpg', 'image/jpeg', 6],
    ['fixtures/generated/jpeg_orientation2_flip.jpg', 'image/jpeg', 2],
    ['fixtures/generated/png_exif_gps.png', 'image/png', 6],
    ['fixtures/generated/webp_exif_gps.webp', 'image/webp', 6],
  ] as const) {
    const bytes = Array.from(readFileSync(path));
    const result = await page.evaluate(async ({ data, type }) => {
      const url = '/src/infrastructure/image.ts';
      const { parseMetadata, makeThumbnail } = await import(url) as typeof import('../../src/infrastructure/image');
      const source = new Uint8Array(data);
      const metadata = await parseMetadata(source);
      const thumb = await makeThumbnail(source, type, crypto.randomUUID(), metadata.sourceOrientation);
      const image = await createImageBitmap(thumb.blob);
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const topLeft = Array.from(context.getImageData(1, 1, 1, 1).data);
      const topRight = Array.from(context.getImageData(image.width - 2, 1, 1, 1).data);
      image.close();
      return { orientation: metadata.sourceOrientation, width: thumb.width, height: thumb.height, topLeft, topRight, thumbnailBytes: Array.from(new Uint8Array(await thumb.blob.arrayBuffer())) };
    }, { data: bytes, type: mime });
    console.log(path, JSON.stringify({ orientation: result.orientation, width: result.width, height: result.height, topLeft: result.topLeft, topRight: result.topRight }));
    expect(result.orientation).toBe(orientation);
    expect(result.topRight[0]! - result.topRight[1]!).toBeGreaterThan(100);
    if (orientation === 6) expect([result.width, result.height]).toEqual([12, 16]);
    if (orientation === 2) expect([result.width, result.height]).toEqual([16, 12]);
    const tags = await ExifReader.load(new Uint8Array(result.thumbnailBytes), { expanded: true });
    expect(tags.exif?.GPSLatitude).toBeUndefined();
    expect(tags.exif?.DateTimeOriginal).toBeUndefined();
  }
});
