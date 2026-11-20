import { describe, expect, it } from 'vitest';
import type { Photo } from '../../src/domain/model';
import { photoDay } from '../../src/presentation/photo-grid';

const photo = (source: string | null, corrected: string | null = null) => ({
  sourceTime: { localClock: source },
  timeCorrection: corrected ? { correctedLocalClock: corrected } : null,
  importedAt: '2026-11-18T00:00:00.000Z',
}) as Photo;

describe('photo grid calendar day', () => {
  it('uses the source local clock without guessing a timezone', () => {
    expect(photoDay(photo('2026:01:02 23:50:00'))).toBe('2026-01-02');
  });
  it('uses an explicit manual correction for the displayed day', () => {
    expect(photoDay(photo('2026:01:02 23:50:00', '2026:01:03 00:10:00'))).toBe('2026-01-03');
  });
  it('does not present import time as capture time', () => {
    expect(photoDay(photo(null))).toBeNull();
  });
});
