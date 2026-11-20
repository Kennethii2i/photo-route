import { describe, expect, it } from 'vitest';
import { newTrip, photoSchema, validateRelations } from '../../src/domain/model';
import { newVisit, reviseVisit } from '../../src/domain/visits';

function photo(tripId: string, datum: 'WGS-84' | null) {
  const now = new Date().toISOString();
  return photoSchema.parse({
    id: crypto.randomUUID(), tripId, visitId: null, originalFilename: 'sample.jpg', sourceMime: 'image/jpeg',
    sourceByteLength: 1, contentSha256: 'a'.repeat(64),
    sourceGps: { rawTags: {}, normalized: datum ? { longitude: 129.87, latitude: 32.73 } : null,
      horizontalErrorMeters: null, datum, status: datum ? 'valid' : 'suspect', issues: [] },
    gpsCorrection: null,
    sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
      localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
    timeCorrection: null, sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [],
    importedAt: now, updatedAt: now, deletedAt: null,
  });
}

describe('Phase 2-B Visit semantics', () => {
  it('keeps Visit and Photo independent, including repeated visits and an empty Visit', () => {
    const trip = newTrip('Trip');
    const first = newVisit(trip.id, '同じ場所', null, { longitude: 129.87, latitude: 32.73 });
    const second = newVisit(trip.id, '同じ場所', null, { longitude: 129.87, latitude: 32.73 });
    const empty = newVisit(trip.id, '写真なし');
    expect(first.id).not.toBe(second.id);
    expect(empty.representativeLocation).toBeNull();
    expect(() => validateRelations([trip], [first, second, empty], [], [])).not.toThrow();
  });

  it('does not turn an unknown photo datum into a confirmed Visit point', () => {
    const trip = newTrip('Trip');
    const uncertain = photo(trip.id, null);
    const visit = newVisit(trip.id, '参考写真', uncertain);
    expect(visit.representativePhotoId).toBe(uncertain.id);
    expect(visit.representativeLocation).toBeNull();
    expect(visit.locationSource).toBe('none');
    expect(uncertain.sourceGps.status).toBe('suspect');
  });

  it('uses only verified WGS84 photo position and keeps source values unchanged on edits', () => {
    const trip = newTrip('Trip');
    const source = photo(trip.id, 'WGS-84');
    const visit = newVisit(trip.id, '写真から', source);
    expect(visit.representativeLocation).toEqual({ longitude: 129.87, latitude: 32.73 });
    expect(visit.locationSource).toBe('selected-photo');
    const edited = reviseVisit(visit, { label: '再訪', point: { longitude: 130, latitude: 33 },
      startAtUtc: '2026-01-01T09:00:00.000Z', endAtUtc: '2026-01-01T10:00:00.000Z' });
    expect(edited.locationSource).toBe('manual');
    expect(edited.id).toBe(visit.id);
    expect(source.sourceGps.normalized).toEqual({ longitude: 129.87, latitude: 32.73 });
    expect(() => reviseVisit(visit, { label: 'bad', point: null, startAtUtc: '2026-01-01T10:00:00.000Z', endAtUtc: '2026-01-01T09:00:00.000Z' })).toThrow();
  });
});
