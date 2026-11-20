import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newTrip, photoSchema, validateRelations, type Photo } from '../../src/domain/model';
import { inspectImage, MAX_DECLARED_PIXELS, MAX_SOURCE_BYTES, MAX_THUMBNAIL_PIXELS, parseMetadata, sha256 } from '../../src/infrastructure/image';

const fixture = (name: string) => new Uint8Array(readFileSync(name));

describe('Phase 1 source semantics', () => {
  it('preserves time evidence and unknown offset', async () => {
    const known = await parseMetadata(fixture('fixtures/generated/jpeg_gps_offset_orientation6.jpg'));
    expect(known.sourceTime.capturedAtUtc).toBe('2020-02-02T19:05:06.000Z');
    expect(known.sourceGps.normalized).toEqual({ longitude: 139.5, latitude: 35.5 });
    expect(known.sourceOrientation).toBe(6);
    const unknown = await parseMetadata(fixture('fixtures/generated/jpeg_local_no_offset.jpg'));
    expect(unknown.sourceTime.localClock).toBe('2020:02:03 04:05:06');
    expect(unknown.sourceTime.capturedAtUtc).toBeNull();
    expect(unknown.sourceTime.status).toBe('local-only');
  });
  it('distinguishes missing, invalid, unknown accuracy, and zero coordinates', async () => {
    expect((await parseMetadata(fixture('fixtures/generated/jpeg_invalid_gps.jpg'))).sourceGps.status).toBe('invalid');
    expect((await parseMetadata(fixture('fixtures/generated/png_no_metadata.png'))).sourceGps.status).toBe('missing');
    expect((await parseMetadata(fixture('fixtures/generated/jpeg_gps_no_accuracy.jpg'))).sourceGps.horizontalErrorMeters).toBeNull();
    expect((await parseMetadata(fixture('fixtures/generated/jpeg_zero_zero.jpg'))).sourceGps.normalized).toEqual({ longitude: 0, latitude: 0 });
  });
  it('sniffs four formats, rejects oversized pixels and hashes original bytes', async () => {
    for (const [path, mime] of [
      ['fixtures/generated/jpeg_gps_offset_orientation6.jpg', 'image/jpeg'],
      ['fixtures/generated/png_exif_gps.png', 'image/png'],
      ['fixtures/generated/webp_exif_gps.webp', 'image/webp'],
      ['fixtures/heif/synthetic_gps_offset_orientation.heic', 'image/heic'],
      ['fixtures/heif/synthetic_no_metadata.heif', 'image/heic'],
    ] as const) expect(inspectImage(fixture(path)).mime).toBe(mime);
    expect(() => inspectImage(fixture('fixtures/generated/png_oversized_header.png'))).toThrow();
    expect(() => inspectImage(fixture('fixtures/generated/jpeg_truncated.jpg'))).toThrow();
    expect(() => inspectImage(new Uint8Array([1, 2, 3]))).toThrow();
    expect(await sha256(fixture('fixtures/generated/jpeg_gps_offset_orientation6.jpg'))).toBe('62a578a0a3d4465bbd7ce6b30ba0a4aa4113999d3e108657a269a6946721e310');
  });
  it('accepts camera JPEG headers through 80MP while rejecting malformed and truncated input', () => {
    expect(MAX_SOURCE_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_THUMBNAIL_PIXELS).toBe(60_000_000);
    expect(MAX_DECLARED_PIXELS).toBe(100_000_000);
    for (const [name, width, height] of [
      ['jpeg_12mp_orientation6.jpg', 4032, 3024],
      ['jpeg_24mp.jpg', 6000, 4000],
      ['jpeg_48mp.jpg', 8000, 6000],
      ['jpeg_80mp_metadata_only.jpg', 10000, 8000],
    ] as const) expect(inspectImage(fixture(`fixtures/camera/${name}`))).toMatchObject({ mime: 'image/jpeg', width, height });
    const truncatedTail = fixture('fixtures/camera/jpeg_24mp.jpg');
    expect(() => inspectImage(truncatedTail.subarray(0, truncatedTail.length - 2))).toThrow('JPEG終端マーカー');
    const oversizedPng = new Uint8Array(20 * 1024 * 1024 + 1);
    oversizedPng.set(fixture('fixtures/generated/png_no_metadata.png'));
    expect(() => inspectImage(oversizedPng)).toThrow('20 MiB');
  });
  it('enforces Photo/Visit and thumbnail links', () => {
    const trip = newTrip('Trip');
    const second = newTrip('Other');
    const source = { sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] }, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] }, sourceOrientation: null };
    const photo = photoSchema.parse({ id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: 'x.jpg', sourceMime: 'image/jpeg', sourceByteLength: 1, contentSha256: 'a'.repeat(64), ...source, gpsCorrection: null, timeCorrection: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null }) as Photo;
    expect(() => validateRelations([trip, second], [], [photo], [])).not.toThrow();
    expect(() => validateRelations([trip, second], [{ id: crypto.randomUUID(), tripId: second.id, label: '', representativeLocation: null, locationSource: 'none', representativePhotoId: null, userStartAtUtc: null, userEndAtUtc: null, createdAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null }], [{ ...photo, visitId: crypto.randomUUID() }], [])).toThrow();
    expect(() => validateRelations([trip], [], [{ ...photo, thumbnailState: 'available' }], [])).toThrow();
    expect(photoSchema.safeParse({ ...photo, sourceTime: { ...photo.sourceTime, capturedAtUtc: '2020-02-02T19:05:06.000Z', status: 'utc-derived', evidence: 'exif-offset' } }).success).toBe(false);
  });
});
