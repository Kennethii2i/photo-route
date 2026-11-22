import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoImporter, type ImportProgress } from '../../src/application/import-photos';
import { newTrip, type Photo } from '../../src/domain/model';
import type { LibraryDb } from '../../src/infrastructure/storage';
import { inspectImage, makeThumbnail, sha256 } from '../../src/infrastructure/image';
import { AutomaticJpegError, makeAutomaticJpeg } from '../../src/infrastructure/automatic-jpeg';

vi.mock('../../src/infrastructure/automatic-jpeg', async original => ({ ...await original<typeof import('../../src/infrastructure/automatic-jpeg')>(), makeAutomaticJpeg: vi.fn() }));
vi.mock('../../src/infrastructure/image', async original => ({ ...await original<typeof import('../../src/infrastructure/image')>(), makeThumbnail: vi.fn() }));
const actual = await vi.importActual<typeof import('../../src/infrastructure/image')>('../../src/infrastructure/image');
const fixture = new Uint8Array(readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg'));
const metadata = await actual.parseMetadata(fixture);
function file(width: number, height: number) {
  const bytes = fixture.slice();
  for (let at = 2; at + 9 < bytes.length; at += 2 + bytes[at + 2]! * 256 + bytes[at + 3]!) {
    if (bytes[at + 1] === 192) { bytes[at + 5] = height >> 8; bytes[at + 6] = height & 255; bytes[at + 7] = width >> 8; bytes[at + 8] = width & 255; return new File([bytes], `${width}-${height}.jpg`); }
  }
  throw new Error('Frame missing');
}
function thumbnail(photoId: string) {
  const blob = new Blob(['synthetic'], { type: 'image/jpeg' });
  return { id: crypto.randomUUID(), photoId, mime: 'image/jpeg' as const, width: 1, height: 1, byteLength: blob.size, blob };
}
function setup() {
  const trip = newTrip('Synthetic automatic import'), photos: Photo[] = [], jobs: ImportProgress['job'][] = [];
  const db = { getTrip: vi.fn(async () => trip), findByHash: vi.fn(async (hash: string) => photos.filter(photo => photo.contentSha256 === hash)),
    savePhoto: vi.fn(async (photo: Photo) => { photos.push(photo); }), saveJob: vi.fn(async (job: ImportProgress['job']) => { jobs.push({ ...job }); }) };
  return { trip, photos, jobs, db, importer: new PhotoImporter(db as unknown as LibraryDb) };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(makeAutomaticJpeg).mockImplementation(async (_bytes, id) => ({ ok: true, metadata, thumbnail: thumbnail(id) }));
  vi.mocked(makeThumbnail).mockImplementation(async (_bytes, _mime, id) => thumbnail(id));
});

describe('automatic import integration', () => {
  it('preserves source length and hash even when the original buffer transfers to the worker', async () => {
    const context = setup(), source = file(16000, 3000), expectedHash = await sha256(new Uint8Array(await source.arrayBuffer()));
    vi.mocked(makeAutomaticJpeg).mockImplementation(async (bytes, id) => { structuredClone(bytes, { transfer: [bytes.buffer as ArrayBuffer] }); return { ok: true, metadata, thumbnail: thumbnail(id) }; });
    const result = await context.importer.importFiles([source], context.trip.id);
    expect(result.outcomes[0]!.state).toBe('imported');
    expect(context.photos[0]).toMatchObject({ sourceByteLength: source.size, contentSha256: expectedHash, ...metadata });
  });
  it('does not overlap an automatic 48MP decode with a normal 24MP decode', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const context = setup();
    vi.mocked(makeAutomaticJpeg).mockImplementation(async (_bytes, id) => { await gate; return { ok: true, metadata, thumbnail: thumbnail(id) }; });
    const pending = context.importer.importFiles([file(16000, 3000), file(6000, 4000)], context.trip.id);
    await vi.waitFor(() => expect(makeAutomaticJpeg).toHaveBeenCalledOnce());
    expect(makeThumbnail).not.toHaveBeenCalled(); release();
    expect((await pending).outcomes.map(value => value.state)).toEqual(['imported', 'imported']);
    expect(makeThumbnail).toHaveBeenCalledOnce();
  });
  it('keeps unsupported new-route files failed, continues others and preserves old partial behavior', async () => {
    const context = setup();
    vi.mocked(makeAutomaticJpeg).mockRejectedValue(new AutomaticJpegError('unsupported'));
    vi.mocked(makeThumbnail).mockImplementation(async (bytes, _mime, id) => { const shape = inspectImage(bytes); if (shape.width! * shape.height! > 60_000_000) throw new Error('decode limit'); return thumbnail(id); });
    const result = await context.importer.importFiles([file(16000, 3000), file(16, 12), file(10000, 8000), file(16000, 4000)], context.trip.id);
    expect(result.outcomes.map(value => value.state)).toEqual(['failed', 'imported', 'partial', 'failed']);
    expect(context.photos).toHaveLength(2); expect(makeAutomaticJpeg).toHaveBeenCalledOnce();
  });
  it('skips duplicates before starting an automatic worker', async () => {
    const context = setup();
    context.db.findByHash.mockResolvedValue([{ tripId: context.trip.id } as Photo]);
    expect((await context.importer.importFiles([file(16000, 3000)], context.trip.id)).outcomes[0]!.state).toBe('skipped-duplicate');
    expect(makeAutomaticJpeg).not.toHaveBeenCalled(); expect(context.photos).toHaveLength(0);
  });
  it('aborts a running automatic worker on user cancellation without saving a photo', async () => {
    const context = setup();
    vi.mocked(makeAutomaticJpeg).mockImplementation((_bytes, _id, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')), { once: true }); }));
    const pending = context.importer.importFiles([file(16000, 3000), file(16, 12)], context.trip.id);
    await vi.waitFor(() => expect(makeAutomaticJpeg).toHaveBeenCalledOnce()); context.importer.cancel();
    expect((await pending).outcomes.map(value => value.state)).toEqual(['cancelled', 'cancelled']); expect(context.photos).toHaveLength(0);
  });
  it('marks fatal image processing interrupted and never commits prepared subsequent files', async () => {
    const context = setup();
    vi.mocked(makeAutomaticJpeg).mockRejectedValue(new AutomaticJpegError('timeout', true));
    await expect(context.importer.importFiles([file(16000, 3000), file(16, 12), file(17, 12)], context.trip.id)).rejects.toThrow('再読み込み');
    expect(context.photos).toHaveLength(0); expect(makeThumbnail).not.toHaveBeenCalled(); expect(context.jobs.at(-1)).toMatchObject({ state: 'interrupted', processed: 0 });
    expect(context.jobs.some(job => job.state === 'completed')).toBe(false);
  });
  it('preserves committed automatic photos if the following progress write fails', async () => {
    const context = setup(); context.db.saveJob.mockImplementation(async job => { if (job.processed) throw new Error('synthetic job failure'); });
    await expect(context.importer.importFiles([file(16000, 3000), file(16, 12)], context.trip.id)).rejects.toThrow('job failure');
    expect(context.photos).toHaveLength(1);
  });
  for (const stop of ['fatal', 'cancel'] as const) {
    it(`does not start a save if ${stop} occurs during the commit-side duplicate lookup`, async () => {
      const context = setup(), normal = file(16, 12), normalHash = await sha256(new Uint8Array(await normal.arrayBuffer()));
      let rejectWorker!: (error: Error) => void, releaseLookup!: () => void, normalLookups = 0;
      const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
      vi.mocked(makeAutomaticJpeg).mockImplementation((_bytes, _id, signal) => new Promise((_resolve, reject) => {
        rejectWorker = reject;
        signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')), { once: true });
      }));
      context.db.findByHash.mockImplementation(async hash => {
        if (hash === normalHash && ++normalLookups === 2) await lookupGate;
        return [];
      });
      const pending = context.importer.importFiles([normal, file(16000, 3000)], context.trip.id);
      const observed = pending.then(value => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
      await vi.waitFor(() => { expect(normalLookups).toBe(2); expect(makeAutomaticJpeg).toHaveBeenCalledOnce(); });
      if (stop === 'fatal') rejectWorker(new AutomaticJpegError('timeout', true)); else context.importer.cancel();
      await new Promise(resolve => setTimeout(resolve, 0)); releaseLookup();
      const result = await observed;
      expect(context.db.savePhoto).not.toHaveBeenCalled(); expect(context.photos).toHaveLength(0);
      if (stop === 'fatal') { expect(result.error).toBeInstanceOf(AutomaticJpegError); expect(context.jobs.at(-1)?.state).toBe('interrupted'); }
      else expect(result.value?.outcomes.map(value => value.state)).toEqual(['cancelled', 'cancelled']);
    });
  }
  for (const secondary of ['job', 'callback'] as const) {
    it(`keeps the reload instruction when fatal processing also encounters a ${secondary} failure`, async () => {
      const context = setup(), failure = new Error(`synthetic ${secondary} failure`);
      vi.mocked(makeAutomaticJpeg).mockRejectedValue(new AutomaticJpegError('timeout', true));
      if (secondary === 'job') context.db.saveJob.mockImplementation(async job => { if (job.state === 'interrupted') throw failure; });
      const notify = (progress: ImportProgress) => { if (secondary === 'callback' && progress.job.state === 'interrupted') throw failure; };
      const error: unknown = await context.importer.importFiles([file(16000, 3000)], context.trip.id, notify).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AutomaticJpegError); expect((error as Error).message).toContain('再読み込み'); expect((error as Error).cause).toBe(failure);
      expect(context.photos).toHaveLength(0);
    });
  }
});
