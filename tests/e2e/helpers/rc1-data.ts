import type { Snapshot, LibraryDb } from '../../../src/infrastructure/storage';

// Browser-only fixture. Legacy modules are extracted unchanged from the stable commit.
export async function seedRcDb(name: string, legacy = false) {
  const root = '/test-results/rc1-legacy/src';
  const storage = legacy
    ? await import(/* @vite-ignore */ `${root}/infrastructure/storage.ts`) as typeof import('../../../src/infrastructure/storage')
    : await import('../../../src/infrastructure/storage');
  const model = legacy
    ? await import(/* @vite-ignore */ `${root}/domain/model.ts`) as typeof import('../../../src/domain/model')
    : await import('../../../src/domain/model');
  const visits = legacy
    ? await import(/* @vite-ignore */ `${root}/domain/visits.ts`) as typeof import('../../../src/domain/visits')
    : await import('../../../src/domain/visits');
  const time = legacy
    ? await import(/* @vite-ignore */ `${root}/domain/time.ts`) as typeof import('../../../src/domain/time')
    : await import('../../../src/domain/time');
  const trips = [model.newTrip('RC-1 合成旅行'), model.newTrip('RC-1 別旅行')];
  const albums = ['港の散歩', '海辺の風景', 'ごみ箱のアルバム', '空アルバム'].map(label => visits.newVisit(trips[0]!.id, label));
  albums[0]!.userStartAtUtc = '2026-01-01T00:00:00.000Z';
  albums[0]!.representativeLocation = { latitude: 32.73, longitude: 129.87 };
  albums[0]!.locationSource = 'manual';
  const thumbnails: Snapshot['thumbnails'] = [];
  const photos: Snapshot['photos'] = [];
  for (let i = 0; i < 60; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = i % 2 ? 240 : 320; canvas.height = i % 2 ? 320 : 240;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `hsl(${180 + i}, 35%, 75%)`; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#467b67'; ctx.fillRect(0, 140, canvas.width, 180);
    ctx.fillStyle = '#fff0b9'; ctx.beginPath(); ctx.arc(170, 60, 25, 0, Math.PI * 2); ctx.fill();
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/jpeg', .86));
    const clock = i % 10 === 0 ? null : `2026:01:02 10:${String(i % 60).padStart(2, '0')}:00`;
    const offset = i % 2 ? '+09:00' : null;
    const photo = model.photoSchema.parse({
      id: crypto.randomUUID(), tripId: i < 54 ? trips[0]!.id : i < 58 ? trips[1]!.id : null,
      visitId: legacy && i < 54 && i % 4 !== 0 ? albums[i % 3]!.id : null,
      originalFilename: `rc1-${String(i).padStart(3, '0')}.jpg`, sourceMime: 'image/jpeg',
      sourceByteLength: 3_000_000 + i, contentSha256: i.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: { SyntheticExif: 'x'.repeat(2048), Sequence: i },
        normalized: i % 7 === 0 ? null : { latitude: 32.73 + i * .0001, longitude: 129.87 },
        horizontalErrorMeters: null, datum: i % 7 === 0 ? null : 'WGS-84', status: i % 7 === 0 ? 'missing' : 'valid', issues: [] },
      sourceTime: { ...time.sourceClockEvidence(clock, offset), rawDateTimeOriginal: clock, rawOffsetTimeOriginal: offset,
        rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] },
      gpsCorrection: i % 9 === 0 ? { value: { latitude: 32.731, longitude: 129.871 }, source: 'manual', correctedAt: trips[0]!.createdAt } : null,
      timeCorrection: i % 11 === 0 ? { correctedLocalClock: '2026:01:02 12:00:00', correctedOffsetMinutes: null,
        correctedUtc: null, source: 'manual', correctedAt: trips[0]!.createdAt } : null,
      sourceOrientation: 6, thumbnailId: crypto.randomUUID(), thumbnailState: 'available', metadataIssues: [],
      importedAt: trips[0]!.createdAt, updatedAt: trips[0]!.createdAt, deletedAt: i === 57 ? trips[0]!.createdAt : null,
    });
    photos.push(photo);
    thumbnails.push({ id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg',
      width: canvas.width, height: canvas.height, byteLength: blob.size, blob });
  }
  const links = legacy ? [] : photos.slice(0, 54).flatMap((photo, i) =>
    (i % 4 === 0 ? [] : [albums[i % 3]!, ...(i % 3 === 0 ? [albums[1]!] : [])])
      .map(album => ({ albumId: album.id, photoId: photo.id, createdAt: null })));
  const db = await storage.LibraryDb.open(name);
  await db.restoreNew(legacy ? { trips, visits: albums, photos, thumbnails } : { trips, visits: albums, photos, thumbnails, links });
  if (legacy) await db.setPhotoVisit(photos[0]!.id, albums[0]!.id);
  await db.moveToTrash('visit', albums[2]!.id);
  return { db, tripId: trips[0]!.id, albums: albums.map(album => album.id), photos: photos.map(photo => photo.id) };
}

export async function fingerprint(db: LibraryDb) {
  const snapshot = await db.snapshot();
  const thumbnails = await Promise.all(snapshot.thumbnails.map(async ({ blob, ...metadata }) => ({ ...metadata,
    sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))
      .map(value => value.toString(16).padStart(2, '0')).join(''),
  })));
  return { trips: snapshot.trips, visits: snapshot.visits, photos: snapshot.photos, thumbnails,
    links: [...(snapshot.links ?? [])].sort((a, b) => `${a.albumId}:${a.photoId}`.localeCompare(`${b.albumId}:${b.photoId}`)) };
}
