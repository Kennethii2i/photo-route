import { readFileSync } from 'node:fs';
import exifr from 'exifr';
import ExifReader from 'exifreader';
import { describe, expect, test } from 'vitest';
import { deriveSourceGps, deriveSourceTime, selectSourceTags } from '../../spikes/p0-t03/source-semantics';

const base = 'fixtures/generated/';
const heif = 'fixtures/heif/';
const bytes = (path: string) => readFileSync(path);

async function selected(path: string) {
  const parsed = await ExifReader.load(bytes(path), { expanded: true });
  return { raw: selectSourceTags(parsed.exif), fileType: parsed.file?.FileType?.value };
}

describe('ExifReader 4.54.0 source capability on fabricated fixtures', () => {
  test.each([
    [`${base}jpeg_gps_offset_orientation6.jpg`, 'jpeg'],
    [`${base}png_exif_gps.png`, 'png'],
    [`${base}webp_exif_gps.webp`, 'webp'],
    [`${heif}synthetic_gps_offset_orientation.heic`, 'heic'],
  ])('retains raw time, GPS rationals and orientation in %s', async (path, format) => {
    const { raw, fileType } = await selected(path);
    expect(fileType).toBe(format);
    expect(raw.dateTimeOriginal).toEqual(['2020:02:03 04:05:06']);
    expect(raw.offsetTimeOriginal).toEqual(['+09:00']);
    expect(raw.gpsLatitude).toEqual([[35, 1], [30, 1], [0, 1]]);
    expect(raw.gpsLongitude).toEqual([[139, 1], [30, 1], [0, 1]]);
    expect(raw.gpsHPositioningError).toEqual([15, 2]);
    expect(raw.orientation).toBe(6);
    expect(deriveSourceTime(raw).capturedAtUtc).toBe('2020-02-02T19:05:06Z');
    expect(deriveSourceGps(raw).normalized).toEqual({ latitude: 35.5, longitude: 139.5 });
  });

  test.each([
    [`${base}png_no_metadata.png`, 'png'],
    [`${base}webp_no_metadata.webp`, 'webp'],
    [`${heif}synthetic_no_metadata.heif`, 'heic'],
  ])('keeps absent EXIF absent in %s', async (path, format) => {
    const { raw, fileType } = await selected(path);
    expect(fileType).toBe(format);
    expect(deriveSourceTime(raw).capturedAtUtc).toBeNull();
    expect(deriveSourceTime(raw).status).toBe('missing');
    expect(deriveSourceGps(raw).status).toBe('missing');
    expect(raw.orientation).toBeNull();
  });

  test('does not turn a source local clock without an offset into UTC', async () => {
    const { raw } = await selected(`${base}jpeg_local_no_offset.jpg`);
    expect(raw.dateTimeOriginal).toEqual(['2020:02:03 04:05:06']);
    expect(raw.offsetTimeOriginal).toBeNull();
    expect(deriveSourceTime(raw)).toMatchObject({
      localClock: '2020:02:03 04:05:06',
      offsetMinutes: null,
      capturedAtUtc: null,
      evidence: 'none',
      status: 'local-only',
    });
  });

  test('GPS timestamp or invalid offset cannot become a shutter-time UTC value', async () => {
    const { raw } = await selected(`${base}jpeg_local_no_offset.jpg`);
    const gpsOnly = { ...raw, dateTimeOriginal: null, gpsDateStamp: ['2020:02:03'], gpsTimeStamp: [[4, 1], [5, 1], [6, 1]] };
    expect(deriveSourceTime(gpsOnly).capturedAtUtc).toBeNull();
    expect(deriveSourceTime(gpsOnly).rawGpsDateStamp).toEqual(['2020:02:03']);
    expect(deriveSourceTime({ ...raw, offsetTimeOriginal: ['+25:00'] }).capturedAtUtc).toBeNull();
    expect(deriveSourceTime({ ...raw, offsetTimeOriginal: ['-00:00'] }).capturedAtUtc).toBeNull();
    expect(deriveSourceTime({ ...raw, dateTimeOriginal: ['2020:02:30 04:05:06'], offsetTimeOriginal: ['+09:00'] }).capturedAtUtc).toBeNull();
  });

  test('rejects invalid GPS but preserves raw tags', async () => {
    const { raw } = await selected(`${base}jpeg_invalid_gps.jpg`);
    const result = deriveSourceGps(raw);
    expect(result.status).toBe('invalid');
    expect(result.normalized).toBeNull();
    expect(result.rawTags.GPSLatitude).toEqual([[95, 1], [30, 1], [0, 1]]);
  });

  test('unknown accuracy stays null, (0,0) remains valid, and datum is not guessed', async () => {
    const noAccuracy = deriveSourceGps((await selected(`${base}jpeg_gps_no_accuracy.jpg`)).raw);
    expect(noAccuracy.status).toBe('valid');
    expect(noAccuracy.horizontalErrorMeters).toBeNull();
    const zeroRaw = (await selected(`${base}jpeg_zero_zero.jpg`)).raw;
    expect(deriveSourceGps(zeroRaw).normalized).toEqual({ latitude: 0, longitude: 0 });
    const unknownDatum = deriveSourceGps({ ...zeroRaw, gpsMapDatum: null });
    expect(unknownDatum.status).toBe('suspect');
    expect(unknownDatum.normalized).toBeNull();
  });

  test('raw orientation is separate from display transforms', async () => {
    const heicRaw = (await selected(`${heif}synthetic_gps_offset_orientation.heic`)).raw;
    const mirrorRaw = (await selected(`${base}jpeg_orientation2_flip.jpg`)).raw;
    expect(heicRaw.orientation).toBe(6);
    expect(mirrorRaw.orientation).toBe(2);
    expect(await exifr.rotation(bytes(`${base}jpeg_gps_offset_orientation6.jpg`))).toMatchObject({ deg: 90, dimensionSwapped: true });
    expect(await exifr.rotation(bytes(`${base}jpeg_orientation2_flip.jpg`))).toMatchObject({ deg: 0, scaleX: -1 });
  });

  test('a truncated JPEG can look like JPEG to a metadata parser', async () => {
    const parsed = await ExifReader.load(bytes(`${base}jpeg_truncated.jpg`), { expanded: true });
    expect(parsed.file?.FileType?.value).toBe('jpeg');
    expect(selectSourceTags(parsed.exif).dateTimeOriginal).toBeNull();
  });
});

describe('exifr 7.1.3 comparison', () => {
  test('reads JPEG and PNG but converts raw GPS rationals to numbers', async () => {
    for (const path of [`${base}jpeg_gps_offset_orientation6.jpg`, `${base}png_exif_gps.png`]) {
      const parsed = await exifr.parse(bytes(path), { reviveValues: false, translateValues: false });
      expect(parsed.Orientation).toBe(6);
      expect(parsed.GPSLatitude).toEqual([35, 30, 0]);
      expect(parsed.GPSHPositioningError).toBe(7.5);
    }
  });

  test('does not parse the WebP fixture', async () => {
    await expect(exifr.parse(bytes(`${base}webp_exif_gps.webp`))).rejects.toThrow('Unknown file format');
  });

  test('reports malformed EXIF for this genuine synthetic HEIC', async () => {
    const parsed = await exifr.parse(bytes(`${heif}synthetic_gps_offset_orientation.heic`));
    expect(parsed.errors?.[0]?.message).toBe('Malformed EXIF data');
    expect(parsed.DateTimeOriginal).toBeUndefined();
  });
});
