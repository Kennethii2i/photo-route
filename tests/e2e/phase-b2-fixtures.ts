import { newTrip, photoSchema, type Photo } from '../../src/domain/model';
import { newVisit } from '../../src/domain/visits';
import { LibraryDb, type AlbumMembershipBatchRequest } from '../../src/infrastructure/storage';

export async function seedAlbumDb(count: number, exifBytes = 0, withThumbnail = false): Promise<{
  name: string; tripId: string; otherTripId: string; albumIds: string[]; photoIds: string[];
}> {
  const name = `phase-b2-${crypto.randomUUID()}`;
  const db = await LibraryDb.open(name);
  const trip = newTrip('Synthetic Trip'), otherTrip = newTrip('Other Trip');
  const albums = ['A', 'B', 'C', 'Trashed'].map(label => newVisit(trip.id, label));
  albums[3] = { ...albums[3]!, deletedAt: new Date().toISOString() };
  const foreign = newVisit(otherTrip.id, 'Foreign');
  const thumbnailId = withThumbnail ? crypto.randomUUID() : null;
  const thumbnailBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const photos: Photo[] = [];
  for (let index = 0; index < count; index++) photos.push(photoSchema.parse({
    id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: `synthetic-${index}.jpg`,
    sourceMime: 'image/jpeg', sourceByteLength: 1000, contentSha256: index.toString(16).padStart(64, '0'),
    sourceGps: { rawTags: exifBytes ? { Synthetic: 'x'.repeat(exifBytes) } : {}, normalized: null,
      horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
    gpsCorrection: { value: { latitude: 35, longitude: 139 }, correctedAt: trip.createdAt, source: 'manual' },
    sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null,
      rawGpsTimeStamp: null, localClock: null, offsetMinutes: null, capturedAtUtc: null,
      status: 'missing', evidence: 'none', issues: [] },
    timeCorrection: null, sourceOrientation: 6, thumbnailId: index === 0 ? thumbnailId : null,
    thumbnailState: index === 0 && thumbnailId ? 'available' : 'failed',
    metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
  }));
  await db.restoreNew({ trips: [trip, otherTrip], visits: [...albums, foreign], photos,
    thumbnails: thumbnailId ? [{ id: thumbnailId, photoId: photos[0]!.id, mime: 'image/png', width: 1, height: 1,
      byteLength: thumbnailBlob.size, blob: thumbnailBlob }] : [] });
  db.close();
  return { name, tripId: trip.id, otherTripId: otherTrip.id, albumIds: [...albums, foreign].map(album => album.id), photoIds: photos.map(photo => photo.id) };
}

export async function membershipRequest(db: LibraryDb, tripId: string, desired: Record<string, string[]>, operationId = crypto.randomUUID()): Promise<AlbumMembershipBatchRequest> {
  const [trips, visits, photos, links] = await Promise.all([db.listTrips(), db.listVisits(), db.listPhotos(), db.listPhotoAlbumLinks()]);
  const photoById = new Map(photos.map(photo => [photo.id, photo]));
  const linksByPhoto = new Map<string, typeof links>();
  for (const link of links) {
    const current = linksByPhoto.get(link.photoId) ?? [];
    current.push(link); linksByPhoto.set(link.photoId, current);
  }
  const changes = Object.entries(desired).map(([photoId, afterAlbumIds]) => ({
    beforePhoto: photoById.get(photoId)!, expectedLinks: linksByPhoto.get(photoId) ?? [], afterAlbumIds,
  }));
  const required = new Set(changes.flatMap(change => [...change.expectedLinks.map(link => link.albumId), ...change.afterAlbumIds]));
  return { operationId, expectedTrip: trips.find(trip => trip.id === tripId)!, expectedAlbums: visits.filter(visit => required.has(visit.id)), changes };
}

export async function seedLegacyV2Move(): Promise<{ name: string; photoId: string; beforeAlbumId: string; afterAlbumId: string }> {
  const name = `phase-b2-legacy-${crypto.randomUUID()}`;
  const trip = newTrip('Legacy synthetic Trip');
  const beforeAlbum = newVisit(trip.id, 'Before');
  const afterAlbum = newVisit(trip.id, 'After');
  const before = photoSchema.parse({
    id: crypto.randomUUID(), tripId: trip.id, visitId: beforeAlbum.id, originalFilename: 'legacy.jpg',
    sourceMime: 'image/jpeg', sourceByteLength: 1000, contentSha256: 'a'.repeat(64),
    sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
    gpsCorrection: null,
    sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
      localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
    timeCorrection: null, sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed',
    metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
  });
  const after = { ...before, visitId: afterAlbum.id, updatedAt: new Date(Date.now() + 1000).toISOString() };
  const opened = indexedDB.open(name, 2);
  opened.onupgradeneeded = () => {
    const db = opened.result;
    db.createObjectStore('trips', { keyPath: 'id' });
    const photos = db.createObjectStore('photos', { keyPath: 'id' });
    photos.createIndex('byHash', 'contentSha256'); photos.createIndex('byTrip', 'tripId');
    db.createObjectStore('visits', { keyPath: 'id' }).createIndex('byTrip', 'tripId');
    db.createObjectStore('thumbnails', { keyPath: 'id' });
    db.createObjectStore('jobs', { keyPath: 'id' });
    db.createObjectStore('recovery', { keyPath: 'sequence', autoIncrement: true });
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error);
  });
  const tx = db.transaction(['trips', 'visits', 'photos', 'recovery'], 'readwrite');
  tx.objectStore('trips').add(trip);
  tx.objectStore('visits').add(beforeAlbum); tx.objectStore('visits').add(afterAlbum);
  tx.objectStore('photos').add(after);
  tx.objectStore('recovery').add({ id: crypto.randomUUID(), kind: 'photo', action: '写真のアルバム所属変更',
    targetId: before.id, createdAt: after.updatedAt, before, after, undoneAt: null });
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  db.close();
  return { name, photoId: before.id, beforeAlbumId: beforeAlbum.id, afterAlbumId: afterAlbum.id };
}
