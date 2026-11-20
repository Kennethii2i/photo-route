import { readFileSync } from 'node:fs';
import ExifReader from 'exifreader';
import { expect, test } from '@playwright/test';

type ThumbResult = {
  status: 'ok' | 'failed';
  sourceWidth?: number;
  sourceHeight?: number;
  width?: number;
  height?: number;
  mime?: string;
  bytes?: number[];
  elapsedMs: number;
  heapBefore: number | null;
  heapAfter: number | null;
  error?: string;
  topLeft?: number[];
  topRight?: number[];
};

async function nativeThumbnail(page: import('@playwright/test').Page, path: string, type: string): Promise<ThumbResult> {
  return page.evaluate(async ({ data, mime }) => {
    const before = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const started = performance.now();
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: mime }));
      const ratio = Math.min(1, 8 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D canvas context');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const topLeft = Array.from(context.getImageData(1, 1, 1, 1).data);
      const topRight = Array.from(context.getImageData(canvas.width - 2, 1, 1, 1).data);
      const thumbnail = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas encoding failed')), 'image/jpeg', 0.8);
      });
      const bytes = Array.from(new Uint8Array(await thumbnail.arrayBuffer()));
      return {
        status: 'ok' as const,
        sourceWidth: bitmap.width,
        sourceHeight: bitmap.height,
        width: canvas.width,
        height: canvas.height,
        mime: thumbnail.type,
        bytes,
        elapsedMs: performance.now() - started,
        heapBefore: before,
        heapAfter: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
        topLeft,
        topRight,
      };
    } catch (error) {
      return {
        status: 'failed' as const,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        elapsedMs: performance.now() - started,
        heapBefore: before,
        heapAfter: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
      };
    } finally {
      bitmap?.close();
    }
  }, { data: Array.from(readFileSync(path)), mime: type });
}

test('native Chrome thumbnail path separates decoding from EXIF parsing', async ({ page }) => {
  await page.goto('/');
  for (const [path, mime] of [
    ['fixtures/generated/jpeg_gps_offset_orientation6.jpg', 'image/jpeg'],
    ['fixtures/generated/png_exif_gps.png', 'image/png'],
    ['fixtures/generated/webp_exif_gps.webp', 'image/webp'],
    ['fixtures/generated/jpeg_orientation2_flip.jpg', 'image/jpeg'],
    ['fixtures/heif/synthetic_gps_offset_orientation.heic', 'image/heic'],
    ['fixtures/heif/synthetic_no_metadata.heif', 'image/heif'],
  ] as const) {
    const result = await nativeThumbnail(page, path, mime);
    console.log(`P0-T04 ${path} ${JSON.stringify({ ...result, bytes: result.bytes?.length })}`);
    if (mime === 'image/heic' || mime === 'image/heif') {
      expect(['ok', 'failed']).toContain(result.status);
      continue; // Browser capability is recorded; the fallback is evaluated separately.
    }
    expect(result.status).toBe('ok');
    expect(result.mime).toBe('image/jpeg');
    expect(Math.max(result.width ?? 0, result.height ?? 0)).toBeLessThanOrEqual(8);
    if (path.includes('orientation6') || path.includes('png_exif')) {
      expect([result.sourceWidth, result.sourceHeight]).toEqual([12, 16]);
      expect((result.topRight?.[0] ?? 0) - (result.topRight?.[1] ?? 0) > 100).toBe(true);
    }
    if (path.includes('webp_exif')) {
      expect([result.sourceWidth, result.sourceHeight]).toEqual([16, 12]);
      expect((result.topLeft?.[0] ?? 0) - (result.topLeft?.[1] ?? 0) > 100).toBe(true);
    }
    if (path.includes('orientation2')) {
      expect((result.topRight?.[0] ?? 0) - (result.topRight?.[1] ?? 0) > 100).toBe(true);
    }
    const tags = await ExifReader.load(new Uint8Array(result.bytes ?? []), { expanded: true });
    expect(tags.exif?.DateTimeOriginal).toBeUndefined();
    expect(tags.exif?.GPSLatitude).toBeUndefined();
  }
});
