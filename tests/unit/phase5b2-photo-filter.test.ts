import { describe, expect, it } from 'vitest';
import type { Photo } from '../../src/domain/model';
import { emptyPhotoFilter, filterPhotos } from '../../src/presentation/photo-filter';

const base = (id: string, name: string, day: string | null, gps: 'confirmed' | 'reference' | 'none', visitId: string | null = null) => ({
  id, originalFilename: name, visitId, importedAt: '2026-11-18T00:00:00.000Z',
  sourceTime: { localClock: day }, timeCorrection: null, gpsCorrection: null,
  sourceGps: gps === 'confirmed'
    ? { rawTags: {}, normalized: { latitude: 32, longitude: 129 }, datum: 'WGS-84', status: 'valid' }
    : gps === 'reference'
      ? { rawTags: { GPSLatitudeRef: 'N', GPSLatitude: [[32, 1], [0, 1], [0, 1]], GPSLongitudeRef: 'E', GPSLongitude: [[129, 1], [0, 1], [0, 1]] }, normalized: null, datum: null, status: 'suspect' }
      : { rawTags: {}, normalized: null, datum: null, status: 'missing' },
}) as Photo;

const photos = [
  base('a', '長崎-港.jpg', '2026:01:02 23:50:00', 'confirmed', 'visit-a'),
  base('b', 'Nagasaki-橋.jpg', null, 'reference'),
  base('c', 'no-gps.jpg', '2026:01:03 10:00:00', 'none'),
];
const linked = new Set(['a']);

describe('Phase 5-B2 photo filtering', () => {
  it('combines exact album IDs with existing conditions without duplicating shared photos', () => {
    const memberships = new Map([['a', ['album-a', 'album-b']], ['b', ['album-b']]]);
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), visit: 'album:album-b' }, linked, memberships).map(photo => photo.id)).toEqual(['a', 'b']);
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), visit: 'album:album-b', gps: 'confirmed', filename: '長崎' }, linked, memberships).map(photo => photo.id)).toEqual(['a']);
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), visit: 'album:missing' }, linked, memberships)).toEqual([]);
  });
  it('matches filenames without mutating the source list', () => {
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), filename: '長崎' }, linked).map(photo => photo.id)).toEqual(['a']);
    expect(photos).toHaveLength(3);
  });
  it('uses local capture day and does not substitute import time', () => {
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), fromDay: '2026-01-03' }, linked).map(photo => photo.id)).toEqual(['c']);
  });
  it('keeps reference positions separate from confirmed GPS and missing GPS', () => {
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), gps: 'confirmed' }, linked).map(photo => photo.id)).toEqual(['a']);
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), gps: 'reference' }, linked).map(photo => photo.id)).toEqual(['b']);
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), gps: 'none' }, linked).map(photo => photo.id)).toEqual(['c']);
  });
  it('filters album links without deriving photo position from an album or the legacy field', () => {
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), visit: 'linked' }, new Set(['a', 'b'])).map(photo => photo.id)).toEqual(['a', 'b']);
    expect(filterPhotos(photos, { ...emptyPhotoFilter(), visit: 'unlinked' }, new Set(['a', 'b'])).map(photo => photo.id)).toEqual(['c']);
  });
  it('uses explicit manual corrections without changing the source evidence', () => {
    const original = base('d', '手動補正.jpg', null, 'none');
    const corrected = { ...original, gpsCorrection: { value: { latitude: 32, longitude: 129 } },
      timeCorrection: { correctedLocalClock: '2026:01:04 09:00:00' } } as Photo;
    expect(filterPhotos([corrected], { ...emptyPhotoFilter(), gps: 'confirmed', fromDay: '2026-01-04' }, linked)).toEqual([corrected]);
    expect(original.sourceGps.status).toBe('missing');
    expect(original.sourceTime.localClock).toBeNull();
  });
});
