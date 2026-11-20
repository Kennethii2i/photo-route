import type { Photo } from './model';
import { parseClockMillis, parseOffsetMinutes } from './time';

export function manualGpsCorrection(latitude: number, longitude: number): NonNullable<Photo['gpsCorrection']> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('緯度は-90〜90、経度は-180〜180の数値で入力してください');
  }
  return { value: { latitude, longitude }, source: 'manual', correctedAt: new Date().toISOString() };
}

export function manualTimeCorrection(localClock: string, offset: string): NonNullable<Photo['timeCorrection']> {
  const clock = parseClockMillis(localClock);
  if (clock === null) throw new Error('撮影日時はYYYY:MM:DD HH:mm:ss形式の実在する日時で入力してください');
  const offsetMinutes = offset === '' ? null : parseOffsetMinutes(offset);
  if (offset !== '' && offsetMinutes === null) throw new Error('時差は+09:00などの形式で入力してください');
  return { correctedLocalClock: localClock, correctedOffsetMinutes: offsetMinutes,
    correctedUtc: offsetMinutes === null ? null : new Date(clock - offsetMinutes * 60_000).toISOString(),
    source: 'manual', correctedAt: new Date().toISOString() };
}

export function formatOffset(minutes: number | null): string {
  if (minutes === null) return '';
  const absolute = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
