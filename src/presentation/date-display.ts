/** Display the source/corrected camera clock as recorded, without timezone conversion. */
export function displayCaptureClock(clock: string | null): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})(?::\d{2})?$/.exec(clock ?? '');
  return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}` : null;
}

/** These values are explicitly stored UTC instants. Never label them local time. */
export function displayUtcInstant(value: string): string {
  return `${value.slice(0, 4)}/${value.slice(5, 7)}/${value.slice(8, 10)} ${value.slice(11, 16)} UTC`;
}

export function displayCalendarDay(day: string): string {
  return `${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}`;
}
