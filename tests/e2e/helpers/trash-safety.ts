import { newTrip, photoSchema, type Thumbnail } from '../../../src/domain/model';
import { newVisit } from '../../../src/domain/visits';
import { LibraryDb } from '../../../src/infrastructure/storage';

export async function seedTrashSafety(name = `trash-safety-${crypto.randomUUID()}`, longFilename?: string) {
  const db = await LibraryDb.open(name);
  const trip = newTrip('合成：削除の確認'), other = newTrip('合成：残す旅行');
  const albums = [newVisit(trip.id, '合成アルバムA'), newVisit(trip.id, '合成アルバムB')];
  const foreignAlbum = newVisit(other.id, '残すアルバム');
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
  canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  const photos = [0, 1].map(index => photoSchema.parse({
    id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: index === 0 && longFilename ? longFilename : `合成写真${index}.jpg`,
    sourceMime: 'image/jpeg', sourceByteLength: 1000, contentSha256: index.toString(16).padStart(64, '0'),
    sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
    sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
      localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
    gpsCorrection: null, timeCorrection: null, sourceOrientation: null, thumbnailId: crypto.randomUUID(), thumbnailState: 'available',
    metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
  }));
  const foreignPhoto = { ...photos[0]!, id: crypto.randomUUID(), tripId: other.id, thumbnailId: crypto.randomUUID(), contentSha256: 'f'.repeat(64) };
  const allPhotos = [...photos, foreignPhoto];
  const thumbnails: Thumbnail[] = allPhotos.map(photo => ({ id: photo.thumbnailId!, photoId: photo.id,
    mime: 'image/png', width: 16, height: 16, byteLength: blob.size, blob }));
  const links = [{ albumId: albums[0]!.id, photoId: photos[0]!.id, createdAt: null },
    { albumId: albums[1]!.id, photoId: photos[0]!.id, createdAt: null },
    { albumId: albums[0]!.id, photoId: photos[1]!.id, createdAt: null },
    { albumId: foreignAlbum.id, photoId: foreignPhoto.id, createdAt: null }];
  await db.restoreNew({ trips: [trip, other], visits: [...albums, foreignAlbum], photos: allPhotos, thumbnails, links });
  await db.saveJob({ id: crypto.randomUUID(), startedAt: trip.createdAt, targetTripId: trip.id, total: 2, processed: 2, state: 'completed', lastError: null });
  db.close();
  return { name, trip: trip.id, other: other.id, albums: albums.map(item => item.id), photos: photos.map(item => item.id) };
}
