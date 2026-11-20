/** Disposable Phase 0 proof: selected source tags remain separate from derived values. */

export interface SelectedSourceTags {
  dateTimeOriginal: unknown | null;
  offsetTimeOriginal: unknown | null;
  gpsDateStamp: unknown | null;
  gpsTimeStamp: unknown | null;
  gpsLatitudeRef: unknown | null;
  gpsLatitude: unknown | null;
  gpsLongitudeRef: unknown | null;
  gpsLongitude: unknown | null;
  gpsMapDatum: unknown | null;
  gpsHPositioningError: unknown | null;
  orientation: unknown | null;
}

const sourceNames = {
  dateTimeOriginal: 'DateTimeOriginal',
  offsetTimeOriginal: 'OffsetTimeOriginal',
  gpsDateStamp: 'GPSDateStamp',
  gpsTimeStamp: 'GPSTimeStamp',
  gpsLatitudeRef: 'GPSLatitudeRef',
  gpsLatitude: 'GPSLatitude',
  gpsLongitudeRef: 'GPSLongitudeRef',
  gpsLongitude: 'GPSLongitude',
  gpsMapDatum: 'GPSMapDatum',
  gpsHPositioningError: 'GPSHPositioningError',
  orientation: 'Orientation',
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function selectSourceTags(exifGroup: unknown): SelectedSourceTags {
  const group = record(exifGroup);
  const value = (name: string): unknown | null => {
    const tag = record(group?.[name]);
    return tag && 'value' in tag ? structuredClone(tag.value) : null;
  };
  return Object.fromEntries(
    Object.entries(sourceNames).map(([field, name]) => [field, value(name)]),
  ) as unknown as SelectedSourceTags;
}

function ascii(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return Array.isArray(value) && value.length === 1 && typeof value[0] === 'string'
    ? value[0]
    : null;
}

function offsetMinutes(value: string | null): number | null {
  const match = value?.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (match[1] === '-' && hours === 0 && minutes === 0) return null;
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

function utcClockMillis(value: string | null): number | null {
  const match = value?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined || second === undefined) return null;
  if (year < 100 || hour > 23 || minute > 59 || second > 59) return null;
  const millis = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(millis);
  if (
    !Number.isFinite(millis) || date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day
  ) return null;
  return millis;
}

export function deriveSourceTime(raw: SelectedSourceTags) {
  const localClock = ascii(raw.dateTimeOriginal);
  const sourceOffset = ascii(raw.offsetTimeOriginal);
  const clockMillis = utcClockMillis(localClock);
  const minutes = offsetMinutes(sourceOffset);
  const capturedAtUtc = clockMillis !== null && minutes !== null
    ? new Date(clockMillis - minutes * 60_000).toISOString().replace('.000Z', 'Z')
    : null;
  return {
    rawDateTimeOriginal: raw.dateTimeOriginal,
    rawOffsetTimeOriginal: raw.offsetTimeOriginal,
    rawGpsDateStamp: raw.gpsDateStamp,
    rawGpsTimeStamp: raw.gpsTimeStamp,
    localClock,
    offsetMinutes: minutes,
    capturedAtUtc,
    evidence: capturedAtUtc === null ? 'none' : 'exif-offset',
    status: clockMillis === null ? (localClock === null ? 'missing' : 'invalid')
      : capturedAtUtc === null ? 'local-only' : 'utc-derived',
  } as const;
}

function rational(value: unknown): number | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [numerator, denominator] = value;
  if (
    typeof numerator !== 'number' || typeof denominator !== 'number' ||
    !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0
  ) return null;
  return numerator / denominator;
}

function coordinate(value: unknown, direction: unknown, positive: string, negative: string): number | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const parts = value.map(rational);
  if (parts.some(part => part === null)) return null;
  const [degrees, minutes, seconds] = parts as number[];
  if (degrees === undefined || minutes === undefined || seconds === undefined) return null;
  if (degrees < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  const ref = ascii(direction);
  if (ref !== positive && ref !== negative) return null;
  return (ref === negative ? -1 : 1) * (degrees + minutes / 60 + seconds / 3600);
}

export function deriveSourceGps(raw: SelectedSourceTags) {
  const rawTags = {
    GPSLatitudeRef: raw.gpsLatitudeRef,
    GPSLatitude: raw.gpsLatitude,
    GPSLongitudeRef: raw.gpsLongitudeRef,
    GPSLongitude: raw.gpsLongitude,
    GPSMapDatum: raw.gpsMapDatum,
    GPSHPositioningError: raw.gpsHPositioningError,
  };
  const present = Object.values(rawTags).some(value => value !== null);
  const latitude = coordinate(raw.gpsLatitude, raw.gpsLatitudeRef, 'N', 'S');
  const longitude = coordinate(raw.gpsLongitude, raw.gpsLongitudeRef, 'E', 'W');
  const datum = ascii(raw.gpsMapDatum);
  const error = rational(raw.gpsHPositioningError);
  const horizontalErrorMeters = error !== null && error >= 0 ? error : null;
  const invalid = latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180;
  return {
    rawTags,
    datum,
    horizontalErrorMeters,
    normalized: !present || invalid || datum !== 'WGS-84' ? null : { latitude, longitude },
    status: !present ? 'missing' : invalid ? 'invalid' : datum !== 'WGS-84' ? 'suspect' : 'valid',
  } as const;
}
