import { z } from 'zod';
import { parseClockMillis, sourceClockEvidence } from './time';

const id = z.string().uuid();
const iso = z.iso.datetime({ offset: false });
const point = z.strictObject({ longitude: z.number().finite().min(-180).max(180), latitude: z.number().finite().min(-90).max(90) });
type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
const json: z.ZodType<Json> = z.lazy(() => z.union([z.null(), z.string(), z.number().finite(), z.boolean(), z.array(json), z.record(z.string(), json)]));

export const tripSchema = z.strictObject({ id, name: z.string().trim().min(1).max(200), createdAt: iso, updatedAt: iso, deletedAt: iso.nullable() });
// null means a v2 membership was migrated without evidence of when it was created.
export const photoAlbumLinkSchema = z.strictObject({ albumId: id, photoId: id, createdAt: iso.nullable() });
export const visitSchema = z.strictObject({ id, tripId: id, label: z.string().max(200), representativeLocation: point.nullable(), locationSource: z.enum(['manual', 'selected-photo', 'none']), representativePhotoId: id.nullable(), userStartAtUtc: iso.nullable(), userEndAtUtc: iso.nullable(), createdAt: iso, updatedAt: iso, deletedAt: iso.nullable() });
export const photoSchema = z.strictObject({
  id, tripId: id.nullable(), visitId: id.nullable(), originalFilename: z.string().min(1).max(255).refine(name => name !== '.' && name !== '..' && !/[\\/]/.test(name) && !Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), 'basename only'),
  sourceMime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  sourceByteLength: z.number().int().positive().max(64 * 1024 * 1024), contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceGps: z.strictObject({ rawTags: z.record(z.string(), json), normalized: point.nullable(), horizontalErrorMeters: z.number().finite().nonnegative().nullable(), datum: z.string().nullable(), status: z.enum(['valid', 'suspect', 'invalid', 'missing']), issues: z.array(z.string()) }),
  gpsCorrection: z.strictObject({ value: point, reason: z.string().optional(), correctedAt: iso, source: z.literal('manual') }).nullable(),
  sourceTime: z.strictObject({ rawDateTimeOriginal: z.string().nullable(), rawOffsetTimeOriginal: z.string().nullable(), rawGpsDateStamp: z.string().nullable(), rawGpsTimeStamp: json.nullable(), localClock: z.string().nullable(), offsetMinutes: z.number().int().min(-840).max(840).nullable(), capturedAtUtc: iso.nullable(), status: z.enum(['utc-derived', 'local-only', 'missing', 'invalid']), evidence: z.enum(['exif-offset', 'explicit-manual', 'none']), issues: z.array(z.string()) }),
  timeCorrection: z.strictObject({ correctedLocalClock: z.string().nullable(), correctedOffsetMinutes: z.number().int().min(-840).max(840).nullable(), correctedUtc: iso.nullable(), source: z.literal('manual'), correctedAt: iso, reason: z.string().optional() }).nullable(),
  sourceOrientation: z.number().int().min(1).max(8).nullable(), thumbnailId: id.nullable(), thumbnailState: z.enum(['available', 'failed', 'not-attempted']),
  metadataIssues: z.array(z.string()), importedAt: iso, updatedAt: iso, deletedAt: iso.nullable(),
}).superRefine((photo, ctx) => {
  if (photo.tripId === null && photo.visitId !== null) ctx.addIssue({ code: 'custom', message: 'unclassified Photo cannot reference Visit' });
  if ((photo.thumbnailState === 'available') !== (photo.thumbnailId !== null)) ctx.addIssue({ code: 'custom', message: 'thumbnail state/link mismatch' });
  if (photo.sourceGps.status === 'valid' && (!photo.sourceGps.normalized || photo.sourceGps.datum !== 'WGS-84')) ctx.addIssue({ code: 'custom', message: 'valid GPS requires WGS-84 point' });
  if (['missing', 'invalid'].includes(photo.sourceGps.status) && photo.sourceGps.normalized) ctx.addIssue({ code: 'custom', message: 'invalid GPS must not have a point' });
  const expected = sourceClockEvidence(photo.sourceTime.rawDateTimeOriginal, photo.sourceTime.rawOffsetTimeOriginal);
  if (photo.sourceTime.localClock !== expected.localClock || photo.sourceTime.offsetMinutes !== expected.offsetMinutes || photo.sourceTime.capturedAtUtc !== expected.capturedAtUtc || photo.sourceTime.status !== expected.status || photo.sourceTime.evidence !== expected.evidence) ctx.addIssue({ code: 'custom', message: 'source time contradicts raw evidence' });
  if (photo.timeCorrection) {
    const correction = photo.timeCorrection;
    const clock = parseClockMillis(correction.correctedLocalClock);
    const utc = clock !== null && correction.correctedOffsetMinutes !== null ? new Date(clock - correction.correctedOffsetMinutes * 60_000).toISOString() : null;
    if (clock === null || correction.correctedUtc !== utc) ctx.addIssue({ code: 'custom', message: 'manual time correction is inconsistent' });
  }
});
export const thumbnailMetaSchema = z.strictObject({ id, photoId: id, mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), width: z.number().int().positive().max(1024), height: z.number().int().positive().max(1024), byteLength: z.number().int().positive().max(1024 * 1024) });
export type Trip = z.infer<typeof tripSchema>;
export type PhotoAlbumLink = z.infer<typeof photoAlbumLinkSchema>;
export type Visit = z.infer<typeof visitSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type ThumbnailMeta = z.infer<typeof thumbnailMetaSchema>;
export type Thumbnail = ThumbnailMeta & { blob: Blob };

export function validateRelations(trips: Trip[], visits: Visit[], photos: Photo[], thumbnails: ThumbnailMeta[]): void {
  const unique = (values: string[]) => { if (new Set(values).size !== values.length) throw new Error('duplicate ID'); };
  unique(trips.map(x => x.id)); unique(visits.map(x => x.id)); unique(photos.map(x => x.id)); unique(thumbnails.map(x => x.id));
  const tripIds = new Set(trips.map(x => x.id));
  const visitById = new Map(visits.map(x => [x.id, x]));
  const photoById = new Map(photos.map(x => [x.id, x]));
  const thumbById = new Map(thumbnails.map(x => [x.id, x]));
  for (const visit of visits) {
    if (!tripIds.has(visit.tripId)) throw new Error('orphan Visit');
    if (visit.representativePhotoId && photoById.get(visit.representativePhotoId)?.tripId !== visit.tripId) throw new Error('invalid representative Photo');
  }
  for (const photo of photos) {
    if (photo.tripId !== null && !tripIds.has(photo.tripId)) throw new Error('orphan Photo');
    if (photo.visitId !== null && (photo.tripId === null || visitById.get(photo.visitId)?.tripId !== photo.tripId)) throw new Error('cross-trip Visit');
    if (photo.thumbnailState === 'available') {
      if (!photo.thumbnailId || thumbById.get(photo.thumbnailId)?.photoId !== photo.id) throw new Error('missing thumbnail');
    } else if (photo.thumbnailId !== null) throw new Error('unexpected thumbnail link');
  }
  for (const thumb of thumbnails) if (photoById.get(thumb.photoId)?.thumbnailId !== thumb.id) throw new Error('orphan thumbnail');
}

export function validateAlbumLinks(trips: Trip[], visits: Visit[], photos: Photo[], links: PhotoAlbumLink[]): void {
  const tripIds = new Set(trips.map(trip => trip.id));
  const visitsById = new Map(visits.map(visit => [visit.id, visit]));
  const photosById = new Map(photos.map(photo => [photo.id, photo]));
  const pairs = new Set<string>();
  for (const photo of photos) if (photo.visitId !== null) throw new Error('ZIP v2では旧Visit所属を使用できません');
  for (const link of links) {
    photoAlbumLinkSchema.parse(link);
    const key = `${link.albumId}:${link.photoId}`;
    if (pairs.has(key)) throw new Error('重複したアルバム所属があります');
    pairs.add(key);
    const album = visitsById.get(link.albumId), photo = photosById.get(link.photoId);
    if (!album || !photo || !tripIds.has(album.tripId) || photo.tripId !== album.tripId)
      throw new Error('アルバム所属の参照または旅行が不正です');
  }
}

export function newTrip(name: string): Trip {
  const now = new Date().toISOString();
  return tripSchema.parse({ id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, deletedAt: null });
}
