import { expect, test } from 'vitest';
import { photoPoints, visitPoints } from '../../src/domain/map';
import { newTrip, photoSchema } from '../../src/domain/model';

test('map layers remain separate and use longitude, latitude without inventing missing locations', () => {
  const trip = newTrip('Synthetic');
  const base = { id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: 'x.jpg', sourceMime: 'image/jpeg', sourceByteLength: 1, contentSha256: 'a'.repeat(64), sourceGps: { rawTags: {}, normalized: { longitude: 139.5, latitude: 35.5 }, horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] }, timeCorrection: null, sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null };
  const point = photoSchema.parse(base);
  const missing = photoSchema.parse({ ...base, id: crypto.randomUUID(), sourceGps: { ...base.sourceGps, normalized: null, status: 'missing' } });
  const suspect = photoSchema.parse({ ...base, id: crypto.randomUUID(), sourceGps: { ...base.sourceGps, datum: null, status: 'suspect' } });
  expect(photoPoints([point, missing, suspect]).features.map(x => x.geometry.coordinates)).toEqual([[139.5, 35.5]]);
  expect(visitPoints([]).features).toEqual([]);
  expect(visitPoints([{ id: crypto.randomUUID(), tripId: trip.id, label: 'Visit', representativeLocation: { longitude: 0, latitude: 0 }, locationSource: 'manual', representativePhotoId: null, userStartAtUtc: null, userEndAtUtc: null, createdAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null }]).features[0]?.geometry.coordinates).toEqual([0, 0]);
});
