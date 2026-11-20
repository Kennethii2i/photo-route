import { expect, test } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { newTrip, photoSchema, type Thumbnail } from '../../src/domain/model';
import { newVisit } from '../../src/domain/visits';
import { exportArchive, inspectArchive, MAX_ARCHIVE_BYTES } from '../../src/infrastructure/archive';
import type { Snapshot } from '../../src/infrastructure/storage';
import { inspectImage } from '../../src/infrastructure/image';

function sample(): Snapshot {
  const trip = newTrip('合成旅行');
  const id = crypto.randomUUID(), thumbId = crypto.randomUUID();
  const thumbBytes = new Uint8Array(readFileSync('fixtures/generated/webp_no_metadata.webp'));
  const size = inspectImage(thumbBytes);
  const thumbnail: Thumbnail = { id: thumbId, photoId: id, mime: 'image/webp', width: size.width!, height: size.height!, byteLength: thumbBytes.length, blob: new Blob([thumbBytes], { type: 'image/webp' }) };
  const photo = photoSchema.parse({ id, tripId: trip.id, visitId: null, originalFilename: '合成.jpg', sourceMime: 'image/jpeg', sourceByteLength: 1056, contentSha256: 'a'.repeat(64), sourceGps: { rawTags: {}, normalized: { longitude: 139.5, latitude: 35.5 }, horizontalErrorMeters: null, datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null, sourceTime: { rawDateTimeOriginal: '2020:02:03 04:05:06', rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, localClock: '2020:02:03 04:05:06', offsetMinutes: null, capturedAtUtc: null, status: 'local-only', evidence: 'none', issues: [] }, timeCorrection: null, sourceOrientation: 1, thumbnailId: thumbId, thumbnailState: 'available', metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null });
  return { trips: [trip], visits: [], photos: [photo], thumbnails: [thumbnail], links: [] };
}

test('versioned archive round trips semantic records and thumbnail, without original source bytes', async () => {
  const source = sample();
  const archive = await exportArchive(source);
  const restored = await inspectArchive(archive);
  expect(restored.trips).toEqual(source.trips);
  expect(restored.photos).toEqual(source.photos);
  expect(new Uint8Array(await restored.thumbnails[0]!.blob.arrayBuffer())).toEqual(new Uint8Array(await source.thumbnails[0]!.blob.arrayBuffer()));
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  expect(Object.keys(entries).sort()).toEqual(['manifest.json', `media/thumbnails/${source.thumbnails[0]!.id}.webp`, 'records/photo-album-links.json', 'records/photos.json', 'records/thumbnails.json', 'records/trips.json', 'records/visits.json'].sort());
  expect(JSON.stringify(entries)).not.toContain('originalBytes');
});

test('archive preflight refuses missing manifest, unsafe path, oversized bytes and checksum mismatch', async () => {
  await expect(exportArchive({ ...sample(), links: undefined } as unknown as Snapshot)).rejects.toThrow('所属リンク集合が必要');
  const bytes = new Uint8Array(await (await exportArchive(sample())).arrayBuffer());
  const entries = unzipSync(bytes);
  const missing = { ...entries }; delete missing['manifest.json'];
  await expect(inspectArchive(new Blob([new Uint8Array(zipSync(missing))]))).rejects.toThrow();
  await expect(inspectArchive(new Blob([new Uint8Array(zipSync({ ...entries, '../escape.txt': new Uint8Array([1]) }))]))).rejects.toThrow();
  const oversized = new Blob(); Object.defineProperty(oversized, 'size', { value: MAX_ARCHIVE_BYTES + 1 });
  await expect(inspectArchive(oversized)).rejects.toThrow();
  entries['records/photos.json'] = new TextEncoder().encode('[]');
  await expect(inspectArchive(new Blob([new Uint8Array(zipSync(entries))]))).rejects.toThrow();
});

test('archive refuses linked orphan even when checksums are recomputed, and compressed bomb before mutation', async () => {
  const entries = unzipSync(new Uint8Array(await (await exportArchive(sample())).arrayBuffer()));
  const photos = JSON.parse(new TextDecoder().decode(entries['records/photos.json']!)) as Array<{ visitId: string | null }>;
  photos[0]!.visitId = crypto.randomUUID();
  const altered = new TextEncoder().encode(JSON.stringify(photos));
  entries['records/photos.json'] = altered;
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as { entries: Array<{ path: string; size: number; sha256: string }> };
  const listing = manifest.entries.find(x => x.path === 'records/photos.json')!;
  listing.size = altered.length; listing.sha256 = createHash('sha256').update(altered).digest('hex');
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  await expect(inspectArchive(new Blob([new Uint8Array(zipSync(entries))]))).rejects.toThrow('cross-trip Visit');

  const bomb = zipSync({ 'manifest.json': new Uint8Array([1]), 'records/trips.json': new Uint8Array([1]), 'records/visits.json': new Uint8Array([1]), 'records/photos.json': new Uint8Array([1]), 'records/thumbnails.json': new Uint8Array(1024 * 1024) }, { level: 9 });
  await expect(inspectArchive(new Blob([new Uint8Array(bomb)]))).rejects.toThrow();
});

test('archive refuses thumbnail dimensions that disagree with image bytes', async () => {
  const entries = unzipSync(new Uint8Array(await (await exportArchive(sample())).arrayBuffer()));
  const metas = JSON.parse(new TextDecoder().decode(entries['records/thumbnails.json']!)) as Array<{ width: number }>;
  metas[0]!.width += 1;
  const changed = new TextEncoder().encode(JSON.stringify(metas));
  entries['records/thumbnails.json'] = changed;
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as { entries: Array<{ path: string; size: number; sha256: string }> };
  const listing = manifest.entries.find(x => x.path === 'records/thumbnails.json')!;
  listing.size = changed.length; listing.sha256 = createHash('sha256').update(changed).digest('hex');
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  await expect(inspectArchive(new Blob([new Uint8Array(zipSync(entries))]))).rejects.toThrow('サムネイルの形式または寸法');
});

test('ZIP v2 preserves every album link and rejects forged or duplicated memberships', async () => {
  const source = sample();
  const albums = ['A', 'B', 'C'].map(label => newVisit(source.trips[0]!.id, label));
  const otherTrip = newTrip('別の旅行'), foreignAlbum = newVisit(otherTrip.id, 'Foreign');
  source.trips.push(otherTrip);
  source.visits.push(foreignAlbum);
  source.visits.push(...albums);
  const links = albums.map((album, index) => ({ albumId: album.id, photoId: source.photos[0]!.id, createdAt: index === 0 ? null : source.trips[0]!.createdAt }));
  const archive = await exportArchive({ ...source, links });
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as { version: number; entries: Array<{ path: string; size: number; sha256: string }> };
  expect(manifest.version).toBe(2);
  expect((await inspectArchive(archive)).links).toEqual([...links].sort((a, b) => a.albumId.localeCompare(b.albumId)));
  const repack = async (changed: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(changed));
    entries['records/photo-album-links.json'] = bytes;
    const listed = manifest.entries.find(entry => entry.path === 'records/photo-album-links.json')!;
    listed.size = bytes.length; listed.sha256 = createHash('sha256').update(bytes).digest('hex');
    entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    return new Blob([new Uint8Array(zipSync(entries))]);
  };
  await expect(inspectArchive(await repack([...links, links[0]]))).rejects.toThrow('重複');
  await expect(inspectArchive(await repack([{ ...links[0], photoId: crypto.randomUUID() }]))).rejects.toThrow('参照');
  await expect(inspectArchive(await repack([{ ...links[0], albumId: crypto.randomUUID() }]))).rejects.toThrow('参照');
  await expect(inspectArchive(await repack([{ ...links[0], albumId: foreignAlbum.id }]))).rejects.toThrow('参照');
  await expect(inspectArchive(await repack([{ ...links[0], createdAt: 'yesterday' }]))).rejects.toThrow();
  await repack(links);
  const unsupported = { ...manifest, version: 3 };
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(unsupported));
  await expect(inspectArchive(new Blob([new Uint8Array(zipSync(entries))]))).rejects.toThrow();
});

test('genuine ZIP v1 converts only Photo.visitId to a single undated link', async () => {
  const source = sample();
  const album = newVisit(source.trips[0]!.id, 'Old Album');
  source.visits.push(album);
  const entries = unzipSync(new Uint8Array(await (await exportArchive(source)).arrayBuffer()));
  delete entries['records/photo-album-links.json'];
  const photos = [{ ...source.photos[0]!, visitId: album.id }];
  const photoBytes = new TextEncoder().encode(JSON.stringify(photos));
  entries['records/photos.json'] = photoBytes;
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as { version: number; entries: Array<{ path: string; size: number; sha256: string }> };
  manifest.version = 1;
  manifest.entries = manifest.entries.filter(entry => entry.path !== 'records/photo-album-links.json');
  const photoEntry = manifest.entries.find(entry => entry.path === 'records/photos.json')!;
  photoEntry.size = photoBytes.length; photoEntry.sha256 = createHash('sha256').update(photoBytes).digest('hex');
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  const v1 = new Blob([new Uint8Array(zipSync(entries))]);
  const restored = await inspectArchive(v1);
  expect(restored.photos[0]).toEqual({ ...source.photos[0], visitId: null });
  expect(restored.links).toEqual([{ albumId: album.id, photoId: source.photos[0]!.id, createdAt: null }]);
  const hybrid = { ...entries, 'records/photo-album-links.json': new TextEncoder().encode('[]') };
  await expect(inspectArchive(new Blob([new Uint8Array(zipSync(hybrid))]))).rejects.toThrow();
});
