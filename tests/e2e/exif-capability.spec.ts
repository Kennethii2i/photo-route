import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('installed Chrome extracts source EXIF from four synthetic formats without image decode', async ({ page }) => {
  await page.goto('/spikes/p0-t03/browser.html');
  await page.waitForFunction(() => window.p0ExifProbe !== undefined);
  for (const [path, fileType] of [
    ['fixtures/generated/jpeg_gps_offset_orientation6.jpg', 'jpeg'],
    ['fixtures/generated/png_exif_gps.png', 'png'],
    ['fixtures/generated/webp_exif_gps.webp', 'webp'],
    ['fixtures/heif/synthetic_gps_offset_orientation.heic', 'heic'],
  ] as const) {
    const bytes = Array.from(readFileSync(path));
    const result = await page.evaluate(data => window.p0ExifProbe!.read(new Uint8Array(data)), bytes);
    expect(result.fileType).toBe(fileType);
    expect(result.rawDateTimeOriginal).toEqual(['2020:02:03 04:05:06']);
    expect(result.rawOffsetTimeOriginal).toEqual(['+09:00']);
    expect(result.rawGpsLatitude).toEqual([[35, 1], [30, 1], [0, 1]]);
    expect(result.rawOrientation).toBe(6);
    expect(result.capturedAtUtc).toBe('2020-02-02T19:05:06Z');
    expect(result.gpsStatus).toBe('valid');
    if (fileType === 'webp') expect(result.exifrFailure).toBe('Unknown file format');
    if (fileType === 'heic') expect(result.exifrFailure).toBe('Malformed EXIF data');
  }

  for (const [path, expectedUtc, expectedGpsStatus] of [
    ['fixtures/generated/jpeg_local_no_offset.jpg', null, 'missing'],
    ['fixtures/generated/jpeg_invalid_gps.jpg', '2020-02-02T19:05:06Z', 'invalid'],
    ['fixtures/generated/jpeg_zero_zero.jpg', '2020-02-02T19:05:06Z', 'valid'],
  ] as const) {
    const result = await page.evaluate(
      data => window.p0ExifProbe!.read(new Uint8Array(data)),
      Array.from(readFileSync(path)),
    );
    expect(result.capturedAtUtc).toBe(expectedUtc);
    expect(result.gpsStatus).toBe(expectedGpsStatus);
  }
  const noExifHeif = await page.evaluate(
    data => window.p0ExifProbe!.read(new Uint8Array(data)),
    Array.from(readFileSync('fixtures/heif/synthetic_no_metadata.heif')),
  );
  expect(noExifHeif.fileType).toBe('heic');
  expect(noExifHeif.rawDateTimeOriginal).toBeNull();
  expect(noExifHeif.capturedAtUtc).toBeNull();
  expect(noExifHeif.gpsStatus).toBe('missing');
});
