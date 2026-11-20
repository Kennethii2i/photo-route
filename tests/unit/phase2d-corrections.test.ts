import { describe, expect, it } from 'vitest';
import { formatOffset, manualGpsCorrection, manualTimeCorrection } from '../../src/domain/corrections';
import { photoSchema } from '../../src/domain/model';

describe('manual corrections', () => {
  it('accepts valid WGS84 coordinates including zero and rejects invalid values', () => {
    expect(manualGpsCorrection(0, 0).value).toEqual({ latitude: 0, longitude: 0 });
    expect(manualGpsCorrection(-33.1, -70.6).value).toEqual({ latitude: -33.1, longitude: -70.6 });
    expect(() => manualGpsCorrection(91, 0)).toThrow();
    expect(() => manualGpsCorrection(Number.NaN, 0)).toThrow();
  });

  it('does not infer UTC without a manual offset and validates the local clock', () => {
    expect(manualTimeCorrection('2026:01:02 03:04:05', '').correctedUtc).toBeNull();
    expect(manualTimeCorrection('2026:01:02 03:04:05', '+09:00').correctedUtc).toBe('2026-01-01T18:04:05.000Z');
    expect(formatOffset(-210)).toBe('-03:30');
    expect(() => manualTimeCorrection('2026:02:30 12:00:00', '+09:00')).toThrow();
    expect(() => manualTimeCorrection('2026:01:02 03:04:05', '+15:00')).toThrow();
  });

  it('rejects an internally inconsistent correction in a persisted Photo', () => {
    const now = new Date().toISOString();
    const base = { id: crypto.randomUUID(), tripId: null, visitId: null, originalFilename: 'synthetic.jpg', sourceMime: 'image/jpeg',
      sourceByteLength: 1, contentSha256: 'a'.repeat(64), sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
      gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
        localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: manualTimeCorrection('2026:01:02 03:04:05', '+09:00'), sourceOrientation: null, thumbnailId: null,
      thumbnailState: 'failed', metadataIssues: [], importedAt: now, updatedAt: now, deletedAt: null };
    expect(photoSchema.safeParse(base).success).toBe(true);
    expect(photoSchema.safeParse({ ...base, timeCorrection: { ...base.timeCorrection, correctedUtc: '2026-01-02T03:04:05.000Z' } }).success).toBe(false);
  });
});
