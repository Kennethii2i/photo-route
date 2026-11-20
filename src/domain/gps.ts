import type { Photo } from './model';

type Point = { latitude: number; longitude: number };
type SourceGps = Photo['sourceGps'];
type DatumKind = 'wgs84' | 'unknown' | 'other';

const scalar = (value: unknown): string | null => typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 && typeof value[0] === 'string' ? value[0] : null;
const rational = (value: unknown): number | null => Array.isArray(value) && value.length === 2 && value.every(x => typeof x === 'number' && Number.isFinite(x)) && value[1] !== 0 ? value[0] / value[1] : null;
const coordinate = (value: unknown, refValue: unknown, plus: string, minus: string): number | null => {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const parts = value.map(rational);
  if (parts.some(x => x === null || x < 0) || parts[1]! >= 60 || parts[2]! >= 60) return null;
  const ref = scalar(refValue);
  if (ref !== plus && ref !== minus) return null;
  return (ref === minus ? -1 : 1) * (parts[0]! + parts[1]! / 60 + parts[2]! / 3600);
};

/** Coordinates are in the source datum until that datum is positively identified. */
export function interpretSourceGpsTags(rawTags: Record<string, unknown>): {
  sourcePoint: Point | null; normalized: Point | null; datum: string | null; datumKind: DatumKind;
  horizontalErrorMeters: number | null; status: SourceGps['status']; issues: string[];
} {
  const names = ['GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude', 'GPSMapDatum', 'GPSHPositioningError'];
  const hasGps = names.some(name => rawTags[name] != null);
  const latitude = coordinate(rawTags.GPSLatitude, rawTags.GPSLatitudeRef, 'N', 'S');
  const longitude = coordinate(rawTags.GPSLongitude, rawTags.GPSLongitudeRef, 'E', 'W');
  const sourcePoint = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
  const rawDatum = scalar(rawTags.GPSMapDatum)?.trim() || null;
  const datumKind: DatumKind = rawDatum === null ? 'unknown' : rawDatum.replace(/[\s_-]/g, '').toUpperCase() === 'WGS84' ? 'wgs84' : 'other';
  const datum = datumKind === 'wgs84' ? 'WGS-84' : rawDatum;
  const accuracy = rational(rawTags.GPSHPositioningError);
  const horizontalErrorMeters = accuracy !== null && accuracy >= 0 ? accuracy : null;
  const status: SourceGps['status'] = !hasGps ? 'missing' : !sourcePoint ? 'invalid' : datumKind === 'wgs84' ? 'valid' : 'suspect';
  const issues = status === 'invalid' ? ['GPS値が不正です']
    : status === 'suspect' && datumKind === 'unknown' ? ['測地系タグがありません。WGS84を仮定した参考位置です。GPS水平誤差は測地系の確実性を示しません。']
      : status === 'suspect' ? ['WGS84以外の測地系が明示されています。変換できないため地図に表示しません。'] : [];
  return { sourcePoint, normalized: status === 'valid' ? sourcePoint : null, datum, datumKind, horizontalErrorMeters, status, issues };
}

/** Re-evaluate persisted raw tags without modifying the stored Photo or its source truth. */
export function sourceGpsDisplay(source: SourceGps): { point: Point | null; state: 'confirmed' | 'reference' | 'unavailable'; locationLabel: string; datumLabel: string; issues: string[] } {
  const current = interpretSourceGpsTags(source.rawTags);
  if (current.status === 'valid') return { point: current.normalized, state: 'confirmed', locationLabel: 'WGS84確認済み', datumLabel: 'WGS-84（Exifで確認）', issues: current.issues };
  if (current.status === 'suspect' && current.datumKind === 'unknown') return { point: current.sourcePoint, state: 'reference', locationLabel: '参考位置・測地系不明', datumLabel: '不明（表示時のみWGS84を仮定）', issues: current.issues };
  // Imported archives and older synthetic records may contain only the validated
  // normalized WGS84 point, without source rational tags.
  if (current.status === 'missing' && source.status === 'valid' && source.datum === 'WGS-84' && source.normalized) {
    return { point: source.normalized, state: 'confirmed', locationLabel: 'WGS84確認済み', datumLabel: 'WGS-84（保存済み）', issues: [] };
  }
  const locationLabel = current.status === 'invalid' ? '無効なGPS値' : current.status === 'suspect' ? '非WGS84のため表示不可' : '位置情報なし';
  return { point: null, state: 'unavailable', locationLabel, datumLabel: current.datum ?? '不明', issues: current.issues };
}
