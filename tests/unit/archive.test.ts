import { describe, expect, it } from 'vitest';
import { createArchive, validateArchive, type ArchiveRecords } from '../../spikes/p0-t07/archive';
import { unzipSync, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';

const records: ArchiveRecords = {
  trips: [{ id: 't1', name: 'synthetic' }], visits: [{ id: 'v1', tripId: 't1' }],
  photos: [{ id: 'p1', tripId: 't1', visitId: 'v1', contentSha256: 'a'.repeat(64), thumbnailId: 'th1' }],
  thumbnail: new Uint8Array(readFileSync('fixtures/generated/webp_no_metadata.webp')),
};

describe('P0-T07 proposed ZIP proof', () => {
  it('round-trips records and thumbnail but not source image bytes', async () => {
    const archive = await createArchive(records);
    const restored = await validateArchive(archive);
    expect(restored).toEqual(records);
    expect(archive.length).toBeLessThan(2048);
  });

  it('rejects collision before returning any staged data', async () => {
    const archive = await createArchive(records);
    await expect(validateArchive(archive, new Set(['t1']))).rejects.toThrow('collision');
  });

  it('rejects an invalid ZIP and tampered archive', async () => {
    await expect(validateArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    const archive = await createArchive(records);
    archive[100] = (archive[100] ?? 0) ^ 1;
    await expect(validateArchive(archive)).rejects.toThrow();
  });

  it('rejects traversal, unsupported version and declared expansion before unzip', async () => {
    const base = await createArchive(records);
    const files = unzipSync(base);
    const traversal = zipSync({ ...files, '../escape.txt': new Uint8Array([1]) }, { level: 0 });
    await expect(validateArchive(traversal)).rejects.toThrow('unsafe path');
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify({ format: 'photo-route-spike', version: 2, thumbnailId: 'th1', thumbnailSha256: 'a'.repeat(64) }));
    await expect(validateArchive(zipSync(files, { level: 0 }))).rejects.toThrow();
    const bomb = new Uint8Array(base);
    const view = new DataView(bomb.buffer);
    for (let i = 0; i < bomb.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 100_000_000, true); break; }
    }
    await expect(validateArchive(bomb)).rejects.toThrow('entry limits');
  });

  it('rejects changed valid JSON records when manifest digests are stale', async () => {
    const files = unzipSync(await createArchive(records));
    files['records/trips.json'] = new TextEncoder().encode(JSON.stringify([{ id: 't1', name: 'altered' }]));
    await expect(validateArchive(zipSync(files, { level: 0 }))).rejects.toThrow('record checksum');
  });

  it('rejects invalid references before archive creation can be trusted', async () => {
    const archive = await createArchive({ ...records, photos: [{ ...records.photos[0]!, visitId: 'absent' }] });
    await expect(validateArchive(archive)).rejects.toThrow('relationships');
  });
});
