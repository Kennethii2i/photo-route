import type { Photo, Visit } from './model';
import { sourceGpsDisplay } from './gps';

export type PointFeature = { type: 'Feature'; id: string; geometry: { type: 'Point'; coordinates: [number, number] }; properties: { kind: 'photo' | 'visit'; id: string; gpsState?: string; visitFocus?: boolean } };
export type PointCollection = { type: 'FeatureCollection'; features: PointFeature[] };

export function photoPoints(photos: Photo[]): PointCollection {
  return { type: 'FeatureCollection', features: photos.flatMap(photo => {
    const source = sourceGpsDisplay(photo.sourceGps);
    const point = photo.gpsCorrection?.value ?? source.point;
    if (!point || photo.deletedAt) return [];
    return [{ type: 'Feature' as const, id: photo.id, geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] as [number, number] }, properties: { kind: 'photo' as const, id: photo.id, gpsState: photo.gpsCorrection ? 'manual' : source.state === 'reference' ? 'datum-unknown-reference' : 'valid' } }];
  }) };
}

export function visitPoints(visits: Visit[]): PointCollection {
  return { type: 'FeatureCollection', features: visits.flatMap(visit => {
    const point = visit.representativeLocation;
    if (!point || visit.deletedAt) return [];
    return [{ type: 'Feature' as const, id: visit.id, geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] as [number, number] }, properties: { kind: 'visit' as const, id: visit.id } }];
  }) };
}
