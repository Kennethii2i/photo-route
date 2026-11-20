import { describe, expect, it } from 'vitest';
import { interpretSourceGpsTags, sourceGpsDisplay } from '../../src/domain/gps';
import { photoPoints } from '../../src/domain/map';
import { newTrip, photoSchema } from '../../src/domain/model';

const tags = (datum: string[] | null = ['WGS-84']) => ({
  GPSLatitudeRef: ['N'], GPSLatitude: [[35, 1], [30, 1], [0, 1]],
  GPSLongitudeRef: ['E'], GPSLongitude: [[139, 1], [30, 1], [0, 1]],
  GPSMapDatum: datum, GPSHPositioningError: [219, 100],
});

describe('GPS datum and source-coordinate interpretation', () => {
  it('projects explicitly WGS84 and keeps measured accuracy independent', () => {
    for (const datum of [['WGS-84'], ['WGS84'], [' WGS 84 ']]) {
      const result = interpretSourceGpsTags(tags(datum));
      expect(result).toMatchObject({ status: 'valid', datum: 'WGS-84', normalized: { latitude: 35.5, longitude: 139.5 }, horizontalErrorMeters: 2.19 });
    }
  });

  it('keeps missing datum unknown and exposes only an explicitly labeled reference point', () => {
    const result = interpretSourceGpsTags(tags(null));
    expect(result).toMatchObject({ status: 'suspect', datumKind: 'unknown', datum: null, normalized: null, sourcePoint: { latitude: 35.5, longitude: 139.5 }, horizontalErrorMeters: 2.19 });
    const display = sourceGpsDisplay({ rawTags: tags(null), normalized: null, horizontalErrorMeters: 2.19, datum: null, status: 'suspect', issues: ['古い誤った警告'] });
    expect(display).toMatchObject({ state: 'reference', locationLabel: '参考位置・測地系不明', point: { latitude: 35.5, longitude: 139.5 } });
    expect(display.issues.join('')).not.toContain('WGS84以外の測地系です');
  });

  it('does not project an explicitly different datum or invalid coordinate', () => {
    const other = interpretSourceGpsTags(tags(['TOKYO']));
    expect(other).toMatchObject({ status: 'suspect', datumKind: 'other', datum: 'TOKYO', normalized: null });
    expect(sourceGpsDisplay({ rawTags: tags(['TOKYO']), normalized: null, horizontalErrorMeters: 2.19, datum: 'TOKYO', status: 'suspect', issues: [] }).point).toBeNull();
    const invalid = interpretSourceGpsTags({ ...tags(null), GPSLatitude: [[95, 1], [0, 1], [0, 1]] });
    expect(invalid).toMatchObject({ status: 'invalid', sourcePoint: null, normalized: null });
    expect(sourceGpsDisplay({ rawTags: { ...tags(null), GPSLatitude: [[95, 1], [0, 1], [0, 1]] }, normalized: null, horizontalErrorMeters: 2.19, datum: null, status: 'invalid', issues: [] }).point).toBeNull();
    expect(sourceGpsDisplay({ rawTags: {}, normalized: null, horizontalErrorMeters: 2.19, datum: null, status: 'suspect', issues: [] }).point).toBeNull();
  });

  it('accepts zero and applies southern/western signs before range checks', () => {
    const zero = interpretSourceGpsTags({ ...tags(null), GPSLatitude: [[0, 1], [0, 1], [0, 1]], GPSLongitude: [[0, 1], [0, 1], [0, 1]] });
    expect(zero.sourcePoint).toEqual({ latitude: 0, longitude: 0 });
    const southwest = interpretSourceGpsTags({ ...tags(null), GPSLatitudeRef: ['S'], GPSLongitudeRef: ['W'] });
    expect(southwest.sourcePoint).toEqual({ latitude: -35.5, longitude: -139.5 });
  });

  it('re-evaluates an existing Photo for the map without changing its persisted fields', () => {
    const trip = newTrip('Saved trip');
    const legacy = photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: 'saved.jpg', sourceMime: 'image/jpeg', sourceByteLength: 1234,
      contentSha256: 'a'.repeat(64), sourceGps: { rawTags: tags(null), normalized: null, horizontalErrorMeters: 2.19, datum: null, status: 'suspect', issues: ['WGS84以外の測地系です。座標を地図に投影しません'] },
      gpsCorrection: null, sourceTime: { rawDateTimeOriginal: '2020:02:03 04:05:06', rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, localClock: '2020:02:03 04:05:06', offsetMinutes: null, capturedAtUtc: null, status: 'local-only', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: 6, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    });
    const before = JSON.stringify(legacy);
    const features = photoPoints([legacy]).features;
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ id: legacy.id, geometry: { coordinates: [139.5, 35.5] }, properties: { gpsState: 'datum-unknown-reference' } });
    expect(JSON.stringify(legacy)).toBe(before);
    expect(legacy.sourceGps.normalized).toBeNull();
    expect(legacy.sourceGps.issues[0]).toContain('WGS84以外');
  });
});
