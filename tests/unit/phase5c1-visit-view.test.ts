import { describe, expect, it } from 'vitest';
import type { Photo, Visit } from '../../src/domain/model';
import { linkedPhotoDateRange, linkedVisitPhotos, sortedVisits, visitFocusPhotoIds, visitTimeLabel } from '../../src/presentation/visit-view';

const visit = (id: string, start: string | null, end: string | null = null) => ({
  id, tripId: 'trip', userStartAtUtc: start, userEndAtUtc: end, createdAt: '2020-01-01T00:00:00.000Z',
}) as Visit;

const photo = (id: string, visitId: string | null, latitude: number | null, longitude: number | null, clock: string | null = null) => ({
  id, visitId, tripId: 'trip', deletedAt: null, sourceTime: { localClock: clock }, timeCorrection: null,
  sourceGps: latitude === null ? { rawTags: {}, normalized: null, datum: null, status: 'missing' }
    : { rawTags: {}, normalized: { latitude, longitude }, datum: 'WGS-84', status: 'valid' }, gpsCorrection: null,
}) as Photo;

describe('Visit browsing semantics', () => {
  it('orders explicit UTC times and leaves missing times separate from creation time', () => {
    const visits = [visit('unknown', null), visit('later', '2026-03-02T09:00:00.000Z'), visit('earlier', '2026-03-01T09:00:00.000Z')];
    expect(sortedVisits(visits).map(item => item.id)).toEqual(['earlier', 'later', 'unknown']);
    expect(visitTimeLabel(visits[0]!)).toBe('設定日時なし');
    expect(visitTimeLabel(visits[2]!)).toBe('手動設定の開始: 2026/03/01 09:00 UTC');
  });
  it('uses album links and local capture order, never representativePhotoId or Photo.visitId', () => {
    const target = { ...visit('a', null), representativePhotoId: 'other' } as Visit;
    const photos = [photo('late', 'a', 32, 129, '2026:01:02 10:00:00'), photo('other', 'b', 32, 129),
      photo('early', 'a', null, null, '2026:01:01 10:00:00'), { ...photo('trashed', 'a', 32, 129), deletedAt: '2026-01-03T00:00:00.000Z' } as Photo];
    expect(linkedVisitPhotos(photos, target, new Set(['early', 'late', 'trashed'])).map(item => item.id)).toEqual(['early', 'late']);
  });
  it('shows only known camera days and respects a manual clock correction without inferring a timezone', () => {
    expect(linkedPhotoDateRange([photo('unknown', 'a', null, null)])).toBeNull();
    expect(linkedPhotoDateRange([photo('a', 'a', null, null, '2026:01:03 09:00:00'),
      photo('b', 'a', null, null, '2026:01:01 10:00:00')])).toBe('2026/01/01 〜 2026/01/03');
    const corrected = { ...photo('c', 'a', null, null, '2026:01:01 08:00:00'),
      timeCorrection: { correctedLocalClock: '2026:01:04 08:00:00' } } as Photo;
    expect(linkedPhotoDateRange([corrected])).toBe('2026/01/04');
  });
  it('uses a strict spatial majority for the viewport and falls back to all when ambiguous', () => {
    const near = [photo('a', 'v', 32.7, 129.8), photo('b', 'v', 32.701, 129.8), photo('c', 'v', 32.702, 129.8)];
    expect(visitFocusPhotoIds([...near, photo('far', 'v', 40, 140), photo('no-gps', 'v', null, null)])).toEqual({
      primary: ['a', 'b', 'c'], all: ['a', 'b', 'c', 'far'],
    });
    expect(visitFocusPhotoIds([near[0]!, near[1]!, photo('x', 'v', 40, 140), photo('y', 'v', 40.001, 140)]) .primary).toHaveLength(4);
  });
});
