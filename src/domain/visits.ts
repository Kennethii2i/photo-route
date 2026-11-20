import { visitSchema, type Photo, type Visit } from './model';

export type VisitPoint = NonNullable<Visit['representativeLocation']>;

function requiredLabel(label: string): string {
  const value = label.trim();
  if (!value) throw new Error('Visit名を入力してください');
  return value;
}

function verifiedPhotoPoint(photo: Photo): VisitPoint | null {
  return photo.gpsCorrection?.value ?? (photo.sourceGps.status === 'valid' ? photo.sourceGps.normalized : null);
}

export function newVisit(tripId: string, label: string, photo: Photo | null = null, mapPoint: VisitPoint | null = null): Visit {
  if (photo && photo.tripId !== tripId) throw new Error('写真とVisitの旅行が異なります');
  if (photo && mapPoint) throw new Error('Visit位置の出典を一つにしてください');
  const point = photo ? verifiedPhotoPoint(photo) : mapPoint;
  const now = new Date().toISOString();
  return visitSchema.parse({
    id: crypto.randomUUID(), tripId, label: requiredLabel(label), representativeLocation: point,
    locationSource: photo ? point ? 'selected-photo' : 'none' : point ? 'manual' : 'none',
    representativePhotoId: photo?.id ?? null, userStartAtUtc: null, userEndAtUtc: null,
    createdAt: now, updatedAt: now, deletedAt: null,
  });
}

export function reviseVisit(visit: Visit, values: { label: string; point: VisitPoint | null; startAtUtc: string | null; endAtUtc: string | null }): Visit {
  const unchangedPoint = JSON.stringify(visit.representativeLocation) === JSON.stringify(values.point);
  const updated = visitSchema.parse({ ...visit, label: requiredLabel(values.label), representativeLocation: values.point,
    locationSource: unchangedPoint ? visit.locationSource : values.point ? 'manual' : 'none',
    userStartAtUtc: values.startAtUtc, userEndAtUtc: values.endAtUtc, updatedAt: new Date().toISOString() });
  if (updated.userStartAtUtc && updated.userEndAtUtc && Date.parse(updated.userEndAtUtc) < Date.parse(updated.userStartAtUtc)) throw new Error('終了日時は開始日時以降にしてください');
  return updated;
}
