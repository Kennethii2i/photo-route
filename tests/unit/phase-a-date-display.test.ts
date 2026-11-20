import { describe, expect, it } from 'vitest';
import { displayCalendarDay, displayCaptureClock, displayUtcInstant } from '../../src/presentation/date-display';

describe('Phase A date display', () => {
  it('formats the recorded camera clock without deriving an offset', () => {
    expect(displayCaptureClock('2026:11:19 08:09:10')).toBe('2026/11/19 08:09');
    expect(displayCaptureClock(null)).toBeNull();
    expect(displayCaptureClock('invalid')).toBeNull();
  });

  it('labels explicit UTC instants and leaves the instant untouched', () => {
    const stored = '2026-11-18T23:09:00.000Z';
    expect(displayUtcInstant(stored)).toBe('2026/11/18 23:09 UTC');
    expect(stored).toBe('2026-11-18T23:09:00.000Z');
    expect(displayCalendarDay('2026-11-18')).toBe('2026/11/18');
  });
});
