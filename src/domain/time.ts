/** Camera wall clock is interpreted as UTC only for arithmetic, never as the browser's timezone. */
export function parseClockMillis(raw: string | null): number | null {
  const match = raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  if (!y || !mo || !d || h === undefined || mi === undefined || s === undefined || y < 100 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const date = new Date(ms);
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === mo && date.getUTCDate() === d ? ms : null;
}

export function parseOffsetMinutes(raw: string | null): number | null {
  const match = raw?.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[2]), m = Number(match[3]);
  if (h > 14 || m > 59 || (h === 14 && m !== 0) || (match[1] === '-' && h === 0 && m === 0)) return null;
  return (match[1] === '-' ? -1 : 1) * (h * 60 + m);
}

export function sourceClockEvidence(rawClock: string | null, rawOffset: string | null) {
  const clock = parseClockMillis(rawClock), offsetMinutes = parseOffsetMinutes(rawOffset);
  const capturedAtUtc = clock !== null && offsetMinutes !== null ? new Date(clock - offsetMinutes * 60_000).toISOString() : null;
  return {
    localClock: rawClock,
    offsetMinutes,
    capturedAtUtc,
    status: rawClock === null ? 'missing' : clock === null ? 'invalid' : capturedAtUtc === null ? 'local-only' : 'utc-derived',
    evidence: capturedAtUtc === null ? 'none' : 'exif-offset',
  } as const;
}
