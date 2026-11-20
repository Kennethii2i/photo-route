/** Disposable v1 ZIP proof. The wire format and size limits are not approved product contracts. */
import { unzipSync, zipSync } from 'fflate';
import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const trip = z.strictObject({ id, name: z.string().max(200) });
const visit = z.strictObject({ id, tripId: id });
const photo = z.strictObject({ id, tripId: id, visitId: id.nullable(), contentSha256: z.string().regex(/^[a-f0-9]{64}$/), thumbnailId: id });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.strictObject({ format: z.literal('photo-route-spike'), version: z.literal(1), thumbnailId: id, thumbnailSha256: hash, tripsSha256: hash, visitsSha256: hash, photosSha256: hash });
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const MAX_ARCHIVE = 8 * 1024 * 1024;
const MAX_ENTRY = 2 * 1024 * 1024;
const MAX_TOTAL = 16 * 1024 * 1024;

export type ArchiveRecords = { trips: z.infer<typeof trip>[]; visits: z.infer<typeof visit>[]; photos: z.infer<typeof photo>[]; thumbnail: Uint8Array };

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && dec.decode(bytes.subarray(0, 4)) === 'RIFF' && dec.decode(bytes.subarray(8, 12)) === 'WEBP';
}

async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}

function preflight(bytes: Uint8Array): string[] {
  if (bytes.length > MAX_ARCHIVE || bytes.length < 22) throw new Error('archive size invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP directory missing');
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  let cursor = view.getUint32(eocd + 16, true);
  if (count < 5 || count > 20 || cursor + directorySize > eocd) throw new Error('ZIP directory limits');
  const names: string[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > eocd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('ZIP entry invalid');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if (flags & 1 || ![0, 8].includes(method) || expanded > MAX_ENTRY || compressed > MAX_ENTRY ||
      (compressed === 0 && expanded > 0) || (compressed > 0 && expanded / compressed > 100)) throw new Error('ZIP entry limits');
    const start = cursor + 46;
    const end = start + nameLength;
    if (nameLength < 1 || end > eocd) throw new Error('ZIP name invalid');
    const name = dec.decode(bytes.subarray(start, end));
    if (name.includes('..') || name.includes('\\') || name.startsWith('/') || name.includes('\0') || names.includes(name)) throw new Error('ZIP unsafe path');
    names.push(name);
    total += expanded;
    if (total > MAX_TOTAL) throw new Error('ZIP total limit');
    cursor = end + extraLength + commentLength;
  }
  if (cursor !== view.getUint32(eocd + 16, true) + directorySize) throw new Error('ZIP directory mismatch');
  return names;
}

export async function createArchive(records: ArchiveRecords): Promise<Uint8Array> {
  if (!isWebp(records.thumbnail)) throw new Error('thumbnail is not WebP');
  const thumbnailId = records.photos[0]?.thumbnailId;
  if (!thumbnailId) throw new Error('thumbnail required for proof');
  const tripsBytes = enc.encode(JSON.stringify(records.trips));
  const visitsBytes = enc.encode(JSON.stringify(records.visits));
  const photosBytes = enc.encode(JSON.stringify(records.photos));
  const manifest = { format: 'photo-route-spike', version: 1, thumbnailId, thumbnailSha256: await digest(records.thumbnail), tripsSha256: await digest(tripsBytes), visitsSha256: await digest(visitsBytes), photosSha256: await digest(photosBytes) };
  const files: Record<string, Uint8Array> = {
    'manifest.json': enc.encode(JSON.stringify(manifest)),
    'records/trips.json': tripsBytes,
    'records/visits.json': visitsBytes,
    'records/photos.json': photosBytes,
    [`media/thumbnails/${thumbnailId}.webp`]: records.thumbnail,
  };
  const bytes = zipSync(files, { level: 0 });
  preflight(bytes);
  return bytes;
}

export async function validateArchive(bytes: Uint8Array, existingTripIds: ReadonlySet<string> = new Set()): Promise<ArchiveRecords> {
  const names = preflight(bytes);
  if (names.length !== 5 || !['manifest.json', 'records/trips.json', 'records/visits.json', 'records/photos.json'].every(name => names.includes(name))) throw new Error('ZIP unexpected entries');
  const entries = unzipSync(bytes);
  const json = (path: string): unknown => JSON.parse(dec.decode(entries[path] ?? new Uint8Array()));
  const manifest = manifestSchema.parse(json('manifest.json'));
  for (const [path, expected] of [
    ['records/trips.json', manifest.tripsSha256], ['records/visits.json', manifest.visitsSha256], ['records/photos.json', manifest.photosSha256],
  ] as const) {
    const entry = entries[path];
    if (!entry || await digest(entry) !== expected) throw new Error('record checksum mismatch');
  }
  const thumbPath = `media/thumbnails/${manifest.thumbnailId}.webp`;
  if (!names.includes(thumbPath)) throw new Error('ZIP thumbnail path invalid');
  const trips = z.array(trip).max(1000).parse(json('records/trips.json'));
  const visits = z.array(visit).max(1000).parse(json('records/visits.json'));
  const photos = z.array(photo).max(5000).parse(json('records/photos.json'));
  const thumbnail = entries[thumbPath];
  if (!thumbnail || !isWebp(thumbnail) || await digest(thumbnail) !== manifest.thumbnailSha256) throw new Error('thumbnail checksum or format mismatch');
  const tripIds = new Set(trips.map(t => t.id));
  const visitTrip = new Map(visits.map(v => [v.id, v.tripId]));
  if (tripIds.size !== trips.length || visitTrip.size !== visits.length || new Set(photos.map(p => p.id)).size !== photos.length) throw new Error('duplicate ID');
  if (trips.some(t => existingTripIds.has(t.id))) throw new Error('trip collision: reject without mutation');
  if (visits.some(v => !tripIds.has(v.tripId)) || photos.some(p => !tripIds.has(p.tripId) || (p.visitId !== null && visitTrip.get(p.visitId) !== p.tripId) || p.thumbnailId !== manifest.thumbnailId)) throw new Error('invalid relationships');
  return { trips, visits, photos, thumbnail };
}
