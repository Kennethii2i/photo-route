import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PhotoCorrectionDrafts } from '../../src/presentation/photo-correction-draft';
import { backupCapacityText } from '../../src/presentation/backup-capacity';
import { PhotoImporter, type ImportProgress } from '../../src/application/import-photos';
import { newTrip } from '../../src/domain/model';
import type { LibraryDb } from '../../src/infrastructure/storage';

vi.mock('../../src/infrastructure/image', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/infrastructure/image')>(),
  makeThumbnail: vi.fn(async () => { throw new Error('synthetic decoder failure'); }),
}));

describe('correction save acknowledgement', () => {
  const initial = { latitude: '', longitude: '', clock: '', offset: '' };
  it('clears only confirmed submitted fields and preserves the other correction', () => {
    const drafts = new PhotoCorrectionDrafts(); drafts.read('p', initial);
    drafts.change('p', 'latitude', '01'); drafts.change('p', 'longitude', '2'); drafts.change('p', 'clock', 'unsaved');
    drafts.saved('p', { latitude: '01', longitude: '2' }, { latitude: '1', longitude: '2' });
    expect(drafts.read('p', { ...initial, latitude: '1', longitude: '2' })).toEqual({ ...initial, latitude: '1', longitude: '2', clock: 'unsaved' });
    expect(drafts.dirtyFields('p', ['latitude', 'longitude'])).toBe(false);
    expect(drafts.dirty('p')).toBe(true);
  });
  it('preserves typing during a write and retains all input without acknowledgement', () => {
    const drafts = new PhotoCorrectionDrafts(); drafts.read('p', initial);
    drafts.change('p', 'latitude', '1'); drafts.change('p', 'longitude', '2');
    const submitted = { latitude: '1', longitude: '2' };
    drafts.change('p', 'latitude', '3'); drafts.saved('p', submitted);
    expect(drafts.read('p', { ...initial, ...submitted }).latitude).toBe('3');
    drafts.change('p', 'offset', '+09:00');
    expect(drafts.read('p', { ...initial, ...submitted }).offset).toBe('+09:00');
    expect(drafts.dirty('p')).toBe(true);
  });
});

describe('backup capacity guidance', () => {
  const counts = { trips: 1, visits: 0, photos: 4999, thumbnails: 0, links: 0 };
  it('warns near and over the boundary without declaring the boundary exceeded at 5000', () => {
    expect(backupCapacityText(counts, 2)).toContain('最大5001枚');
    expect(backupCapacityText({ ...counts, photos: 5000 })).not.toContain('上限を超え');
    expect(backupCapacityText({ ...counts, photos: 5001 })).toContain('全体バックアップを作成できません');
    expect(backupCapacityText(counts)).toContain('全旅行・ごみ箱');
    expect(backupCapacityText(counts)).toContain('通常保存は64 MiB');
    expect(backupCapacityText(counts)).toContain('直接保存は256 MiB');
  });
  it('checks every ZIP record limit', () => {
    for (const [key, value] of Object.entries({ trips: 1001, visits: 5001, thumbnails: 5001, links: 150001 })) {
      expect(backupCapacityText({ ...counts, [key]: value })).toContain('上限を超え');
    }
  });
});

describe('import progress failures', () => {
  const file = () => new File([readFileSync('fixtures/generated/png_no_metadata.png')], 'synthetic.png', { type: 'image/png' });
  function fakeDb(duplicate: boolean, failProgress = false) {
    const trip = newTrip('Synthetic'); const attempts: ImportProgress['job'][] = [];
    const db = {
      getTrip: vi.fn(async () => trip),
      findByHash: vi.fn(async () => duplicate ? [{ tripId: trip.id }] : []),
      savePhoto: vi.fn(async () => {}),
      saveJob: vi.fn(async (job: ImportProgress['job']) => { attempts.push({ ...job }); if (failProgress && attempts.length === 3) throw new Error('synthetic progress write failure'); }),
    };
    return { trip, db, attempts, importer: new PhotoImporter(db as unknown as LibraryDb) };
  }
  it('counts a duplicate once', async () => {
    const { trip, importer } = fakeDb(true);
    const result = await importer.importFiles([file()], trip.id);
    expect(result.job).toMatchObject({ processed: 1, total: 1, state: 'completed' });
    expect(result.outcomes.map(item => item.state)).toEqual(['skipped-duplicate']);
  });
  it('does not reinterpret a failed progress save as a second file outcome', async () => {
    const { trip, importer, db, attempts } = fakeDb(true, true);
    await expect(importer.importFiles([file()], trip.id)).rejects.toThrow('progress write failure');
    expect(attempts.map(job => job.processed)).toEqual([0, 0, 1]);
    expect(db.savePhoto).not.toHaveBeenCalled();
  });
  it('rejects a job failure after a committed photo without claiming completion or deleting it', async () => {
    const { trip, importer, db, attempts } = fakeDb(false, true);
    await expect(importer.importFiles([file()], trip.id)).rejects.toThrow('progress write failure');
    expect(db.savePhoto).toHaveBeenCalledOnce();
    expect(attempts.at(-1)).toMatchObject({ processed: 1, state: 'running' });
  });
});
