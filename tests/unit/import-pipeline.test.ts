import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoImporter, type ImportProgress } from '../../src/application/import-photos';
import { newTrip, type Photo } from '../../src/domain/model';
import type { LibraryDb } from '../../src/infrastructure/storage';
import * as image from '../../src/infrastructure/image';

vi.mock('../../src/infrastructure/image', async original => ({
  ...await original<typeof image>(),
  inspectImage: vi.fn(), sha256: vi.fn(), parseMetadata: vi.fn(), makeThumbnail: vi.fn(),
}));
const realImage = await vi.importActual<typeof image>('../../src/infrastructure/image');
const metadata = await realImage.parseMetadata(new Uint8Array(readFileSync('fixtures/generated/png_no_metadata.png')));
const thumbnail = async (...args: Parameters<typeof image.makeThumbnail>) => {
  const photoId = args[2];
  const blob = new Blob(['synthetic'], { type: 'image/jpeg' });
  return { id: crypto.randomUUID(), photoId, mime: 'image/jpeg' as const, width: 1, height: 1, byteLength: blob.size, blob };
};
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function file(marker: number, size = 1) {
  const bytes = new Uint8Array(size); bytes[0] = marker;
  return new File([bytes], `${marker}.jpg`, { type: 'image/jpeg' });
}
function setup() {
  const trip = newTrip('Synthetic pipeline');
  const photos: Photo[] = [], jobs: ImportProgress['job'][] = [];
  const db = {
    getTrip: vi.fn(async () => trip),
    findByHash: vi.fn(async (hash: string) => photos.filter(photo => photo.contentSha256 === hash)),
    savePhoto: vi.fn(async (photo: Photo) => { photos.push(photo); }),
    saveJob: vi.fn(async (job: ImportProgress['job']) => { jobs.push({ ...job }); }),
  };
  return { trip, photos, jobs, db, importer: new PhotoImporter(db as unknown as LibraryDb) };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(image.inspectImage).mockReturnValue({ mime: 'image/jpeg', width: 6000, height: 4000 });
  vi.mocked(image.sha256).mockImplementation(async bytes => bytes[0]!.toString(16).padStart(64, '0'));
  vi.mocked(image.parseMetadata).mockResolvedValue(metadata);
  vi.mocked(image.makeThumbnail).mockImplementation(thumbnail);
});

describe('bounded import preparation and ordered commits', () => {
  it('holds only the first two inputs while the first is delayed, then commits in input order', async () => {
    const gate = deferred(), context = setup();
    vi.mocked(image.makeThumbnail).mockImplementation(async (...args) => { if (args[0][0] === 1) await gate.promise; return thumbnail(...args); });
    const result = context.importer.importFiles([file(1), file(2), file(3), file(4)], context.trip.id);
    await vi.waitFor(() => expect(image.makeThumbnail).toHaveBeenCalledTimes(2));
    expect(context.db.savePhoto).not.toHaveBeenCalled();
    expect(image.inspectImage).toHaveBeenCalledTimes(2);
    gate.resolve();
    expect((await result).outcomes.map(value => value.state)).toEqual(Array(4).fill('imported'));
    expect(context.photos.map(photo => photo.originalFilename)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg']);
  });

  it('skips an identical input after the first commits, but retries it if the first save failed', async () => {
    for (const failFirst of [false, true]) {
      const context = setup();
      if (failFirst) context.db.savePhoto.mockRejectedValueOnce(new DOMException('synthetic quota', 'QuotaExceededError'));
      const result = await context.importer.importFiles([file(1), file(1)], context.trip.id);
      expect(result.outcomes.map(value => value.state)).toEqual(failFirst ? ['failed', 'imported'] : ['imported', 'skipped-duplicate']);
      expect(context.photos).toHaveLength(1);
      expect(result.job.processed).toBe(2);
    }
  });

  it('lets a committed duplicate win over speculative metadata failure', async () => {
    const context = setup();
    vi.mocked(image.parseMetadata).mockResolvedValueOnce(metadata).mockRejectedValueOnce(new Error('synthetic metadata error'));
    const result = await context.importer.importFiles([file(1), file(1)], context.trip.id);
    expect(result.outcomes.map(value => value.state)).toEqual(['imported', 'skipped-duplicate']);
    expect(result.job.lastError).toBeNull();
  });

  it('does not save or start further inputs after cancellation from progress', async () => {
    const context = setup();
    const result = await context.importer.importFiles([file(1), file(2), file(3), file(4)], context.trip.id, progress => {
      if (progress.job.processed === 1) context.importer.cancel();
    });
    expect(result.outcomes.map(value => value.state)).toEqual(['imported', 'cancelled', 'cancelled', 'cancelled']);
    expect(context.photos).toHaveLength(1);
    expect(image.inspectImage).toHaveBeenCalledTimes(2);
    expect(result.job).toMatchObject({ processed: 4, state: 'cancelled' });
  });

  it('drains speculative work after job failure without saving or publishing it', async () => {
    const gate = deferred(), context = setup();
    vi.mocked(image.makeThumbnail).mockImplementation(async (...args) => { if (args[0][0] === 2) await gate.promise; return thumbnail(...args); });
    context.db.saveJob.mockImplementation(async job => { if (job.processed === 1) throw new Error('synthetic job failure'); });
    const progress = vi.fn();
    const pending = expect(context.importer.importFiles([file(1), file(2), file(3)], context.trip.id, progress)).rejects.toThrow('synthetic job failure');
    await vi.waitFor(() => expect(context.photos).toHaveLength(1));
    expect(image.inspectImage).toHaveBeenCalledTimes(2);
    gate.resolve(); await pending;
    expect(context.photos).toHaveLength(1);
    expect(progress.mock.calls.map(([value]) => value.job.processed)).toEqual([0]);
    expect(context.db.saveJob.mock.calls.some(([job]) => job.state === 'completed')).toBe(false);
  });

  it('keeps the photo but stops subsequent commits when progress callback throws', async () => {
    const context = setup();
    await expect(context.importer.importFiles([file(1), file(2), file(3)], context.trip.id, progress => {
      if (progress.job.processed === 1) throw new Error('synthetic callback error');
    })).rejects.toThrow('synthetic callback error');
    expect(context.photos).toHaveLength(1);
    expect(context.jobs.at(-1)).toMatchObject({ processed: 1, state: 'running' });
  });

  it('serializes input buffers that together exceed 64MiB', async () => {
    const gate = deferred(), context = setup(), first = file(1, 34 * 1024 * 1024), second = file(2, 34 * 1024 * 1024);
    const readSecond = vi.spyOn(second, 'arrayBuffer');
    vi.mocked(image.makeThumbnail).mockImplementation(async (...args) => { if (args[0][0] === 1) await gate.promise; return thumbnail(...args); });
    const result = context.importer.importFiles([first, second], context.trip.id);
    await vi.waitFor(() => expect(image.makeThumbnail).toHaveBeenCalledTimes(1));
    expect(readSecond).not.toHaveBeenCalled();
    gate.resolve();
    expect((await result).outcomes.every(value => value.state === 'imported')).toBe(true);
    expect(readSecond).toHaveBeenCalledOnce();
  });

  it('serializes two 48MP decodes and does not start a waiting decode after cancellation', async () => {
    const gate = deferred(), context = setup();
    vi.mocked(image.inspectImage).mockReturnValue({ mime: 'image/jpeg', width: 8000, height: 6000 });
    vi.mocked(image.makeThumbnail).mockImplementation(async (...args) => { await gate.promise; return thumbnail(...args); });
    const result = context.importer.importFiles([file(1), file(2)], context.trip.id);
    await vi.waitFor(() => expect(image.parseMetadata).toHaveBeenCalledTimes(2));
    expect(image.makeThumbnail).toHaveBeenCalledTimes(1);
    context.importer.cancel(); gate.resolve();
    expect((await result).outcomes.map(value => value.state)).toEqual(['imported', 'cancelled']);
    expect(image.makeThumbnail).toHaveBeenCalledTimes(1);
  });

  it('passes oversized decode candidates to the existing partial-success path without hanging', async () => {
    const context = setup();
    vi.mocked(image.inspectImage).mockReturnValue({ mime: 'image/jpeg', width: 10000, height: 8000 });
    vi.mocked(image.makeThumbnail).mockRejectedValue(new Error('サムネイル復号の安全上限を超えています'));
    const result = await context.importer.importFiles([file(1), file(2)], context.trip.id);
    expect(result.outcomes.map(value => value.state)).toEqual(['partial', 'partial']);
    expect(context.photos.every(photo => photo.thumbnailId === null)).toBe(true);
  });

  it('releases decode capacity after failure so the waiting image can import', async () => {
    const context = setup();
    vi.mocked(image.inspectImage).mockReturnValue({ mime: 'image/jpeg', width: 8000, height: 6000 });
    vi.mocked(image.makeThumbnail).mockRejectedValueOnce(new Error('synthetic decoder failure'));
    const result = await context.importer.importFiles([file(1), file(2)], context.trip.id);
    expect(result.outcomes.map(value => value.state)).toEqual(['partial', 'imported']);
  });

  it('does not read a source-budget waiter after cancellation', async () => {
    const gate = deferred(), context = setup(), first = file(1, 34 * 1024 * 1024), second = file(2, 34 * 1024 * 1024);
    const readSecond = vi.spyOn(second, 'arrayBuffer');
    vi.mocked(image.makeThumbnail).mockImplementation(async (...args) => { await gate.promise; return thumbnail(...args); });
    const result = context.importer.importFiles([first, second], context.trip.id);
    await vi.waitFor(() => expect(image.makeThumbnail).toHaveBeenCalledTimes(1));
    context.importer.cancel(); gate.resolve();
    expect((await result).outcomes.map(value => value.state)).toEqual(['imported', 'cancelled']);
    expect(readSecond).not.toHaveBeenCalled();
  });

  it('allows an explicit different-trip copy but skips the second identical input in the same batch', async () => {
    const context = setup(), otherTrip = newTrip('Synthetic other trip');
    context.db.findByHash.mockImplementation(async hash => [
      { tripId: otherTrip.id } as Photo,
      ...context.photos.filter(photo => photo.contentSha256 === hash),
    ]);
    const result = await context.importer.importFiles([file(1), file(1)], context.trip.id, undefined, { allowDuplicateAcrossTrips: true });
    expect(result.outcomes.map(value => value.state)).toEqual(['imported', 'skipped-duplicate']);
    expect(result.outcomes[0]!.reason).toContain('別の旅行');
    expect(context.photos).toHaveLength(1);
  });

  it('releases input capacity after a read failure and continues the next input', async () => {
    const context = setup(), first = file(1, 34 * 1024 * 1024), second = file(2, 34 * 1024 * 1024);
    vi.spyOn(first, 'arrayBuffer').mockRejectedValue(new Error('synthetic read error'));
    const result = await context.importer.importFiles([first, second], context.trip.id);
    expect(result.outcomes.map(value => value.state)).toEqual(['failed', 'imported']);
    expect(context.photos).toHaveLength(1);
  });
});
