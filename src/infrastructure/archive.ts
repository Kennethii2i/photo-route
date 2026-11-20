import { z } from 'zod';
import { photoAlbumLinkSchema, photoSchema, thumbnailMetaSchema, tripSchema, validateAlbumLinks, validateRelations, visitSchema, type Photo, type PhotoAlbumLink, type Thumbnail, type Trip, type Visit } from '../domain/model';
import { inspectImage, sha256 } from './image';
import { LibraryDb, type Snapshot } from './storage';
import { MAX_ARCHIVE_BYTES, MAX_BUFFERED_ARCHIVE_BYTES, MAX_ENTRIES, MAX_RECORD_ENTRY_BYTES, openZip, ZipStreamWriter } from './zip-stream';

export { MAX_ARCHIVE_BYTES, MAX_BUFFERED_ARCHIVE_BYTES } from './zip-stream';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.strictObject({ path: z.string(), size: z.number().int().nonnegative().max(MAX_RECORD_ENTRY_BYTES), sha256: hex });
const manifestSchema = z.strictObject({ format: z.literal('photo-route'), version: z.union([z.literal(1), z.literal(2)]), exportId: z.uuid(), exportedAt: z.iso.datetime({ offset: false }), entries: z.array(entrySchema).min(4).max(MAX_ENTRIES) });
const dataNames = ['records/trips.json', 'records/visits.json', 'records/photos.json', 'records/thumbnails.json'];
const linksName = 'records/photo-album-links.json';
const mediaPath = (id: string, mime: string) => `media/thumbnails/${id}.${mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'}`;
const checkCancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('処理を中断しました', 'AbortError'); };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Blob) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const byLink = (links: PhotoAlbumLink[]) => [...links].sort((a, b) => a.albumId.localeCompare(b.albumId) || a.photoId.localeCompare(b.photoId));
const jsonBytes = (value: unknown) => encoder.encode(canonical(value));
const readJson = (bytes: Uint8Array): unknown => JSON.parse(decoder.decode(bytes));

function validateSnapshot(snapshot: Snapshot): void {
  if (!Array.isArray(snapshot.links)) throw new Error('ZIP v2の書き出しには所属リンク集合が必要です');
  if (snapshot.trips.length > 1000 || snapshot.visits.length > 5000 || snapshot.photos.length > 5000 || snapshot.thumbnails.length > 5000) throw new Error('記録件数の暫定上限を超えています');
  if (snapshot.links.length > 150000) throw new Error('アルバム所属件数の暫定上限を超えています');
  snapshot.trips.forEach(x => tripSchema.parse(x)); snapshot.visits.forEach(x => visitSchema.parse(x)); snapshot.photos.forEach(x => photoSchema.parse(x));
  for (const thumb of snapshot.thumbnails) {
    const { blob, ...meta } = thumb;
    thumbnailMetaSchema.parse(meta);
    if (blob.size !== thumb.byteLength || blob.type !== thumb.mime) throw new Error('サムネイルBlobが不正です');
  }
  validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
  validateAlbumLinks(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.links);
}

export async function streamArchive(snapshot: Snapshot, stream: WritableStream<Uint8Array>, options: { signal?: AbortSignal; maxBytes?: number } = {}): Promise<number> {
  validateSnapshot(snapshot);
  if (snapshot.thumbnails.length + 6 > MAX_ENTRIES) throw new Error('ZIPエントリ件数の暫定上限を超えています');
  const records: Record<string, Uint8Array> = {
    'records/trips.json': jsonBytes(byId(snapshot.trips)),
    'records/visits.json': jsonBytes(byId(snapshot.visits)),
    'records/photos.json': jsonBytes(byId(snapshot.photos)),
    'records/thumbnails.json': jsonBytes(byId(snapshot.thumbnails.map(x => ({ id: x.id, photoId: x.photoId, mime: x.mime, width: x.width, height: x.height, byteLength: x.byteLength })))),
    [linksName]: jsonBytes(byLink(snapshot.links)),
  };
  const maxBytes = options.maxBytes ?? MAX_ARCHIVE_BYTES;
  const projected = Object.values(records).reduce((sum, bytes) => sum + bytes.length, 0)
    + snapshot.thumbnails.reduce((sum, thumb) => sum + thumb.byteLength, 0) + (snapshot.thumbnails.length + 6) * 300 + 4096;
  if (projected > maxBytes) throw new Error('ZIP書き出しサイズの暫定上限を超えています');
  const writer = new ZipStreamWriter(stream, maxBytes, options.signal);
  const entries: Array<{ path: string; size: number; sha256: string }> = [];
  try {
    for (const [path, bytes] of Object.entries(records)) {
      checkCancelled(options.signal);
      await writer.add(path, bytes);
      entries.push({ path, size: bytes.length, sha256: await sha256(bytes) });
    }
    for (const thumb of byId(snapshot.thumbnails)) {
      checkCancelled(options.signal);
      const path = mediaPath(thumb.id, thumb.mime), bytes = new Uint8Array(await thumb.blob.arrayBuffer());
      await writer.add(path, bytes);
      entries.push({ path, size: bytes.length, sha256: await sha256(bytes) });
    }
    const manifest = jsonBytes({ format: 'photo-route', version: 2, exportId: crypto.randomUUID(), exportedAt: new Date().toISOString(), entries: entries.sort((a, b) => a.path.localeCompare(b.path)) });
    await writer.add('manifest.json', manifest);
    return await writer.close();
  } catch (error) { await writer.abort(); throw error; }
}

export async function exportArchive(snapshot: Snapshot, options: { signal?: AbortSignal } = {}): Promise<Blob> {
  const chunks: BlobPart[] = [];
  const stream = new WritableStream<Uint8Array>({ write(chunk) { chunks.push(new Uint8Array(chunk)); }, abort() { chunks.length = 0; } });
  await streamArchive(snapshot, stream, { ...(options.signal ? { signal: options.signal } : {}), maxBytes: MAX_BUFFERED_ARCHIVE_BYTES });
  return new Blob(chunks, { type: 'application/zip' });
}

export async function inspectArchive(blob: Blob, signal?: AbortSignal): Promise<Snapshot> {
  const zip = await openZip(blob, signal);
  const manifest = manifestSchema.parse(readJson(await zip.read('manifest.json')));
  const expected = new Map(manifest.entries.map(entry => [entry.path, entry]));
  if (new Set(manifest.entries.map(x => x.path)).size !== manifest.entries.length || expected.size !== zip.entries.size - 1 ||
    [...zip.entries.keys()].some(name => name !== 'manifest.json' && !expected.has(name))) throw new Error('ZIPマニフェストのエントリが一致しません');
  if (manifest.version === 1 && (zip.entries.has(linksName) || manifest.entries.length > 5004 || zip.entries.size > 5005))
    throw new Error('ZIP v1に未対応の所属情報または過大なエントリがあります');
  if (manifest.version === 2 && !zip.entries.has(linksName)) throw new Error('ZIP v2に所属情報がありません');
  const readChecked = async (path: string) => {
    const entry = expected.get(path);
    if (!entry) throw new Error(`ZIPマニフェストにありません: ${path}`);
    const bytes = await zip.read(path);
    if (bytes.length !== entry.size || await sha256(bytes) !== entry.sha256) throw new Error(`ZIPチェックサム不一致: ${path}`);
    return bytes;
  };
  const recordBytes: Uint8Array[] = [];
  for (const name of dataNames) recordBytes.push(await readChecked(name));
  const [tripBytes, visitBytes, photoBytes, thumbMetaBytes] = recordBytes;
  const trips = z.array(tripSchema).max(1000).parse(readJson(tripBytes!));
  const visits = z.array(visitSchema).max(5000).parse(readJson(visitBytes!));
  const originalPhotos = z.array(photoSchema).max(5000).parse(readJson(photoBytes!));
  const thumbMetas = z.array(thumbnailMetaSchema).max(5000).parse(readJson(thumbMetaBytes!));
  const links = manifest.version === 2 ? z.array(photoAlbumLinkSchema).max(150000).parse(readJson(await readChecked(linksName)))
    : originalPhotos.flatMap(photo => photo.visitId ? [{ albumId: photo.visitId, photoId: photo.id, createdAt: null }] : []);
  const photos = manifest.version === 1 ? originalPhotos.map(photo => ({ ...photo, visitId: null })) : originalPhotos;
  const mediaNames = [...zip.entries.keys()].filter(name => name.startsWith('media/'));
  if (mediaNames.length !== thumbMetas.length) throw new Error('サムネイル件数が一致しません');
  const thumbnails: Thumbnail[] = [];
  for (const meta of thumbMetas) {
    checkCancelled(signal);
    const path = mediaPath(meta.id, meta.mime), data = await readChecked(path);
    if (data.length !== meta.byteLength) throw new Error('サムネイルの参照が不正です');
    const actual = inspectImage(data);
    if (actual.mime !== meta.mime || actual.width !== meta.width || actual.height !== meta.height) throw new Error('サムネイルの形式または寸法が不正です');
    thumbnails.push({ ...meta, blob: new Blob([new Uint8Array(data)], { type: meta.mime }) });
  }
  const snapshot = { trips, visits, photos, thumbnails, links };
  validateSnapshot(snapshot);
  return snapshot;
}

const subset = (snapshot: Snapshot, tripId: string): Snapshot => {
  const photos = snapshot.photos.filter(x => x.tripId === tripId);
  const thumbIds = new Set(photos.map(x => x.thumbnailId));
  const photoIds = new Set(photos.map(photo => photo.id));
  return { trips: snapshot.trips.filter(x => x.id === tripId), visits: snapshot.visits.filter(x => x.tripId === tripId), photos, thumbnails: snapshot.thumbnails.filter(x => thumbIds.has(x.id)), links: snapshot.links.filter(link => photoIds.has(link.photoId)) };
};
async function fingerprint(snapshot: Snapshot, signal?: AbortSignal): Promise<string> {
  const thumbHashes = [];
  for (const { blob, ...meta } of byId(snapshot.thumbnails)) { checkCancelled(signal); thumbHashes.push({ ...meta, sha256: await sha256(new Uint8Array(await blob.arrayBuffer())) }); }
  return sha256(jsonBytes({ trips: byId(snapshot.trips), visits: byId(snapshot.visits), photos: byId(snapshot.photos), thumbnails: thumbHashes, links: byLink(snapshot.links) }));
}

export async function verifyExportArchive(source: Snapshot, blob: Blob, signal?: AbortSignal): Promise<void> {
  if (await fingerprint(source, signal) !== await fingerprint(await inspectArchive(blob, signal), signal)) throw new Error('書き出したZIPの再検証に失敗しました');
}

type RestoreClassification = { newTrips: Trip[]; identicalTripIds: string[]; conflictingTripIds: string[]; newUnclassified: Photo[]; conflictingUnclassified: Photo[] };
async function classifyRestore(incoming: Snapshot, current: Snapshot, signal?: AbortSignal): Promise<RestoreClassification> {
  const oldTrips = new Set(current.trips.map(x => x.id));
  const newTrips: Trip[] = [], identicalTripIds: string[] = [], conflictingTripIds: string[] = [];
  for (const trip of incoming.trips) {
    checkCancelled(signal);
    if (!oldTrips.has(trip.id)) newTrips.push(trip);
    else if (await fingerprint(subset(incoming, trip.id), signal) === await fingerprint(subset(current, trip.id), signal)) identicalTripIds.push(trip.id);
    else conflictingTripIds.push(trip.id);
  }
  const oldPhotos = new Map(current.photos.map(x => [x.id, x]));
  const incomingThumbs = new Map(incoming.thumbnails.map(thumb => [thumb.id, thumb]));
  const currentThumbs = new Map(current.thumbnails.map(thumb => [thumb.id, thumb]));
  const newUnclassified: Photo[] = [], conflictingUnclassified: Photo[] = [];
  for (const photo of incoming.photos.filter(x => x.tripId === null)) {
    checkCancelled(signal);
    const existing = oldPhotos.get(photo.id);
    if (!existing) { newUnclassified.push(photo); continue; }
    const thumb = photo.thumbnailId ? incomingThumbs.get(photo.thumbnailId) : undefined;
    const currentThumb = existing.thumbnailId ? currentThumbs.get(existing.thumbnailId) : undefined;
    const sameThumb = thumb && currentThumb ? await sha256(new Uint8Array(await thumb.blob.arrayBuffer())) === await sha256(new Uint8Array(await currentThumb.blob.arrayBuffer())) : Boolean(thumb) === Boolean(currentThumb);
    if (canonical(existing) !== canonical(photo) || !sameThumb) conflictingUnclassified.push(photo);
  }
  return { newTrips, identicalTripIds, conflictingTripIds, newUnclassified, conflictingUnclassified };
}

export async function previewArchiveRestore(db: LibraryDb, blob: Blob, signal?: AbortSignal): Promise<{ newTrips: number; identicalTrips: number; conflictingTrips: number; conflictingUnclassifiedPhotos: number; newUnclassifiedPhotos: number }> {
  const c = await classifyRestore(await inspectArchive(blob, signal), await db.snapshot(), signal);
  return { newTrips: c.newTrips.length, identicalTrips: c.identicalTripIds.length, conflictingTrips: c.conflictingTripIds.length, conflictingUnclassifiedPhotos: c.conflictingUnclassified.length, newUnclassifiedPhotos: c.newUnclassified.length };
}

function remapTrip(part: Snapshot): Snapshot {
  const original = part.trips[0]!;
  const tripId = crypto.randomUUID();
  const visitIds = new Map(part.visits.map(visit => [visit.id, crypto.randomUUID()]));
  const photoIds = new Map(part.photos.map(photo => [photo.id, crypto.randomUUID()]));
  const thumbnailIds = new Map(part.thumbnails.map(thumb => [thumb.id, crypto.randomUUID()]));
  return {
    trips: [{ ...original, id: tripId, name: `${original.name.slice(0, 190)}（復元コピー）` }],
    visits: part.visits.map(visit => ({ ...visit, id: visitIds.get(visit.id)!, tripId,
      representativePhotoId: visit.representativePhotoId ? photoIds.get(visit.representativePhotoId)! : null })),
    photos: part.photos.map(photo => ({ ...photo, id: photoIds.get(photo.id)!, tripId,
      visitId: null, thumbnailId: photo.thumbnailId ? thumbnailIds.get(photo.thumbnailId)! : null })),
    thumbnails: part.thumbnails.map(thumb => ({ ...thumb, id: thumbnailIds.get(thumb.id)!, photoId: photoIds.get(thumb.photoId)! })),
    links: part.links.map(link => ({ ...link, albumId: visitIds.get(link.albumId)!, photoId: photoIds.get(link.photoId)! })),
  };
}

export async function restoreArchive(db: LibraryDb, blob: Blob, mode: 'reject-conflicts' | 'copy-conflicts' = 'reject-conflicts', signal?: AbortSignal): Promise<{ state: 'imported' | 'skipped-identical'; trips: number; photos: number }> {
  const incoming = await inspectArchive(blob, signal); // validate untrusted bytes and links before mutation
  const c = await classifyRestore(incoming, await db.snapshot(), signal);
  if (mode === 'reject-conflicts' && c.conflictingTripIds.length) throw new Error('同じIDの旅行に異なる内容があります。既存データは変更しません');
  if (mode === 'reject-conflicts' && c.conflictingUnclassified.length) throw new Error('未分類写真のID衝突があります。既存データは変更しません');
  const newTrips: Trip[] = [], newVisits: Visit[] = [], newPhotos: Photo[] = [], newThumbs: Thumbnail[] = [], newLinks: PhotoAlbumLink[] = [];
  const incomingThumbs = new Map(incoming.thumbnails.map(thumb => [thumb.id, thumb]));
  const conflictingUnclassifiedIds = new Set(c.conflictingUnclassified.map(photo => photo.id));
  for (const trip of incoming.trips) {
    checkCancelled(signal);
    if (c.identicalTripIds.includes(trip.id)) continue;
    const part = c.conflictingTripIds.includes(trip.id) ? remapTrip(subset(incoming, trip.id)) : subset(incoming, trip.id);
    newTrips.push(...part.trips); newVisits.push(...part.visits); newPhotos.push(...part.photos); newThumbs.push(...part.thumbnails); newLinks.push(...part.links);
  }
  for (const photo of [...c.newUnclassified, ...c.conflictingUnclassified]) {
    checkCancelled(signal);
    const thumb = photo.thumbnailId ? incomingThumbs.get(photo.thumbnailId) : undefined;
    if (conflictingUnclassifiedIds.has(photo.id)) {
      const photoId = crypto.randomUUID(), thumbId = thumb ? crypto.randomUUID() : null;
      newPhotos.push({ ...photo, id: photoId, thumbnailId: thumbId });
      if (thumb && thumbId) newThumbs.push({ ...thumb, id: thumbId, photoId });
    } else { newPhotos.push(photo); if (thumb) newThumbs.push(thumb); }
  }
  if (!newTrips.length && !newPhotos.length) return { state: 'skipped-identical', trips: 0, photos: 0 };
  checkCancelled(signal);
  await db.restoreNew({ trips: newTrips, visits: newVisits, photos: newPhotos, thumbnails: newThumbs, links: newLinks }, signal);
  return { state: 'imported', trips: newTrips.length, photos: newPhotos.length };
}
