import type { Photo, Visit } from '../domain/model';
import { photoPoints } from '../domain/map';
import { displayCalendarDay, displayUtcInstant } from './date-display';
import { photoDay } from './photo-grid';

export function visitTimeKey(visit: Visit): string | null { return visit.userStartAtUtc ?? visit.userEndAtUtc; }

export function visitTimeLabel(visit: Visit): string {
  if (!visit.userStartAtUtc && !visit.userEndAtUtc) return '設定日時なし';
  if (visit.userStartAtUtc && visit.userEndAtUtc) return `手動設定: ${displayUtcInstant(visit.userStartAtUtc)} 〜 ${displayUtcInstant(visit.userEndAtUtc)}`;
  return visit.userStartAtUtc ? `手動設定の開始: ${displayUtcInstant(visit.userStartAtUtc)}` : `手動設定の終了: ${displayUtcInstant(visit.userEndAtUtc!)}`;
}

export function sortedVisits(visits: Visit[]): Visit[] {
  return [...visits].sort((a, b) => {
    const first = visitTimeKey(a), second = visitTimeKey(b);
    return first && second ? first.localeCompare(second) || a.id.localeCompare(b.id)
      : first ? -1 : second ? 1 : a.id.localeCompare(b.id);
  });
}

export function linkedVisitPhotos(photos: Photo[], visit: Visit, linkedPhotoIds: ReadonlySet<string>): Photo[] {
  return photos.filter(photo => linkedPhotoIds.has(photo.id) && photo.tripId === visit.tripId && !photo.deletedAt)
    .sort((a, b) => {
      const first = a.timeCorrection?.correctedLocalClock ?? a.sourceTime.localClock;
      const second = b.timeCorrection?.correctedLocalClock ?? b.sourceTime.localClock;
      return first && second ? first.localeCompare(second) || a.id.localeCompare(b.id)
        : first ? -1 : second ? 1 : a.id.localeCompare(b.id);
    });
}

/** Display-only camera calendar range; unknown offsets never become a UTC or visit time. */
export function linkedPhotoDateRange(photos: Photo[]): string | null {
  const days = photos.map(photoDay).filter((day): day is string => day !== null).sort();
  if (!days.length) return null;
  const first = displayCalendarDay(days[0]!);
  const last = displayCalendarDay(days.at(-1)!);
  return first === last ? first : `${first} 〜 ${last}`;
}

/** Viewport only: a strict spatial majority within 10 km may exclude distant outliers. */
export function visitFocusPhotoIds(photos: Photo[]): { primary: string[]; all: string[] } {
  const features = photoPoints(photos).features;
  const all = features.map(feature => feature.id);
  if (features.length < 4) return { primary: all, all };
  const latitude = [...features.map(feature => feature.geometry.coordinates[1])].sort((a, b) => a - b)[Math.floor(features.length / 2)]!;
  const longitude = [...features.map(feature => feature.geometry.coordinates[0])].sort((a, b) => a - b)[Math.floor(features.length / 2)]!;
  const centerCos = Math.cos(latitude * Math.PI / 180);
  const primary = features.filter(feature => {
    const [lon, lat] = feature.geometry.coordinates;
    const eastKm = (lon - longitude) * 111.32 * centerCos;
    const northKm = (lat - latitude) * 111.32;
    return Math.hypot(eastKm, northKm) <= 10;
  }).map(feature => feature.id);
  return { primary: primary.length > features.length * 2 / 3 ? primary : all, all };
}
