import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  const origin = test.info().project.use.baseURL as string;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto('/fixtures/camera/manifest.json');
});

test('serial and parallel imports preserve metadata, orientation, thumbnail bytes and partial results', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { sha256 } = await import('../../src/infrastructure/image');
    const { newTrip, validateRelations } = await import('../../src/domain/model');
    const paths = ['camera/jpeg_12mp_orientation6.jpg', 'camera/jpeg_24mp.jpg', 'generated/jpeg_gps_offset_orientation6.jpg', 'generated/png_exif_gps.png', 'generated/webp_no_metadata.webp', 'camera/jpeg_80mp_metadata_only.jpg', 'heif/synthetic_gps_offset_orientation.heic', 'heif/synthetic_no_metadata.heif'];
    const files: File[] = [];
    for (const path of paths) files.push(new File([await (await fetch(`/fixtures/${path}`)).blob()], path.split('/').at(-1)!, { type: path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }));
    files.push(files[0]!);
    const runs = [];
    for (const concurrency of [1, 2] as const) {
      const db = await LibraryDb.open(`pipeline-equivalence-${crypto.randomUUID()}`);
      try {
        const trip = newTrip('Synthetic equivalence'); await db.createTrip(trip);
        const report = await new PhotoImporter(db, concurrency).importFiles(files, trip.id);
        const snapshot = await db.snapshot();
        validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
        const thumbs = new Map(snapshot.thumbnails.map(thumb => [thumb.id, thumb]));
        const photos = [];
        for (const photo of snapshot.photos.sort((a, b) => a.originalFilename.localeCompare(b.originalFilename))) {
          const thumb = thumbs.get(photo.thumbnailId ?? '');
          photos.push({ name: photo.originalFilename, hash: photo.contentSha256, gps: photo.sourceGps, time: photo.sourceTime, orientation: photo.sourceOrientation,
            issues: photo.metadataIssues, thumbnail: thumb ? { width: thumb.width, height: thumb.height, hash: await sha256(new Uint8Array(await thumb.blob.arrayBuffer())) } : null });
        }
        const oriented = snapshot.photos.find(photo => photo.originalFilename === 'jpeg_12mp_orientation6.jpg')!;
        const bitmap = await createImageBitmap(thumbs.get(oriented.thumbnailId!)!.blob);
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
        const topRight = Array.from(context.getImageData(canvas.width - 8, 8, 1, 1).data);
        runs.push({ states: report.outcomes.map(value => value.state), photos, topRight, count: snapshot.photos.length, thumbnails: snapshot.thumbnails.length });
      } finally { db.close(); }
    }
    return runs;
  });
  expect(result[1]).toEqual(result[0]);
  expect(result[1]?.states).toEqual(['imported', 'imported', 'imported', 'imported', 'imported', 'partial', 'partial', 'partial', 'skipped-duplicate']);
  expect(result[1]?.count).toBe(8); expect(result[1]?.thumbnails).toBe(5);
  const oriented = result[1]!.photos.find(photo => photo.name === 'jpeg_12mp_orientation6.jpg')!;
  expect(oriented.orientation).toBe(6); expect(oriented.thumbnail).toMatchObject({ width: 384, height: 512 });
  expect(result[1]!.topRight[0]).toBeGreaterThan(result[1]!.topRight[1]! + 100);
  expect(result[1]!.photos.find(photo => photo.name === 'jpeg_gps_offset_orientation6.jpg')!.gps.normalized).not.toBeNull();
});

test('thumbnail write failure rolls back its photo and the next input still imports', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, validateRelations } = await import('../../src/domain/model');
    const db = await LibraryDb.open(`pipeline-quota-${crypto.randomUUID()}`);
    const trip = newTrip('Synthetic quota'); await db.createTrip(trip);
    const files = [];
    for (const name of ['jpeg_gps_offset_orientation6.jpg', 'png_exif_gps.png']) files.push(new File([await (await fetch(`/fixtures/generated/${name}`)).blob()], name));
    const original = IDBObjectStore.prototype.add;
    let injected = false;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'thumbnails' && !injected) { injected = true; throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    try {
      const report = await new PhotoImporter(db).importFiles(files, trip.id);
      const snapshot = await db.snapshot();
      validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
      return { states: report.outcomes.map(value => value.state), names: snapshot.photos.map(photo => photo.originalFilename), thumbnails: snapshot.thumbnails.length };
    } finally { IDBObjectStore.prototype.add = original; db.close(); }
  });
  expect(result).toEqual({ states: ['failed', 'imported'], names: ['png_exif_gps.png'], thumbnails: 1 });
});

test('transactional guard still rejects a duplicate saved by another connection after the final lookup', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip } = await import('../../src/domain/model');
    const name = `pipeline-race-${crypto.randomUUID()}`;
    const first = await LibraryDb.open(name), second = await LibraryDb.open(name);
    try {
      const trip = newTrip('Synthetic concurrent duplicate'); await first.createTrip(trip);
      const blob = await (await fetch('/fixtures/generated/jpeg_gps_offset_orientation6.jpg')).blob();
      const original = first.savePhoto.bind(first);
      first.savePhoto = async (...args) => { await second.savePhoto(...args); await original(...args); };
      const report = await new PhotoImporter(first).importFiles([new File([blob], 'race.jpg')], trip.id);
      const snapshot = await first.snapshot();
      return { state: report.outcomes[0]!.state, photos: snapshot.photos.length, thumbnails: snapshot.thumbnails.length };
    } finally { first.close(); second.close(); }
  });
  expect(result).toEqual({ state: 'failed', photos: 1, thumbnails: 1 });
});

test('transactional guard rejects a trip deleted after preparation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip } = await import('../../src/domain/model');
    const name = `pipeline-trip-${crypto.randomUUID()}`;
    const first = await LibraryDb.open(name), second = await LibraryDb.open(name);
    try {
      const trip = newTrip('Synthetic deleted trip'); await first.createTrip(trip);
      const blob = await (await fetch('/fixtures/generated/jpeg_gps_offset_orientation6.jpg')).blob();
      const original = first.savePhoto.bind(first);
      first.savePhoto = async (...args) => { await second.moveToTrash('trip', trip.id); await original(...args); };
      const report = await new PhotoImporter(first).importFiles([new File([blob], 'deleted-trip.jpg')], trip.id);
      const snapshot = await first.snapshot();
      return { state: report.outcomes[0]!.state, photos: snapshot.photos.length, thumbnails: snapshot.thumbnails.length };
    } finally { first.close(); second.close(); }
  });
  expect(result).toEqual({ state: 'failed', photos: 0, thumbnails: 0 });
});
