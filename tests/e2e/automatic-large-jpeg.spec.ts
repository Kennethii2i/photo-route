import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createTripUi, localUi, photoListUi } from './helpers/ux-rc-flows';

test.beforeEach(async ({ context }) => {
  const origin = test.info().project.use.baseURL as string;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

test('automatic JPEGs preserve source evidence, orientation, original bytes and ZIP round-trip', async ({ page }) => {
  test.setTimeout(120_000); await page.goto('/fixtures/camera/manifest.json');
  const result = await page.evaluate(async () => {
    const { largeJpegBase, orientedJpeg, expectedTopRight } = await import('../../tests/e2e/helpers/automatic-jpeg-fixtures');
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, validateRelations } = await import('../../src/domain/model');
    const { sha256, inspectImage, parseMetadata } = await import('../../src/infrastructure/image');
    const { exportArchive, inspectArchive, restoreArchive } = await import('../../src/infrastructure/archive');
    const db = await LibraryDb.open(`automatic-evidence-${crypto.randomUUID()}`), restoredDb = await LibraryDb.open(`automatic-restored-${crypto.randomUUID()}`);
    try {
      const trip = newTrip('Synthetic automatic evidence'); await db.createTrip(trip);
      const base = await largeJpegBase(), files = [];
      for (let orientation = 1; orientation <= 8; orientation++) files.push(await orientedJpeg(base, orientation));
      const hashes = await Promise.all(files.map(async file => sha256(new Uint8Array(await file.arrayBuffer()))));
      const report = await new PhotoImporter(db).importFiles(files, trip.id);
      const snapshot = await db.snapshot(); validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
      const rows = [];
      for (let index = 0; index < files.length; index++) {
        const photo = snapshot.photos.find(photo => photo.id === report.outcomes[index]!.photoId)!;
        const thumb = snapshot.thumbnails.find(thumb => thumb.photoId === photo.id)!;
        const bitmap = await createImageBitmap(thumb.blob);
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
        const pixel = Array.from(context.getImageData(canvas.width - 8, 8, 1, 1).data).slice(0, 3);
        const previewInfo = await parseMetadata(new Uint8Array(await thumb.blob.arrayBuffer()));
        rows.push({ state: report.outcomes[index]!.state, before: hashes[index], after: await sha256(new Uint8Array(await files[index]!.arrayBuffer())), savedHash: photo.contentSha256,
          sourceBytes: files[index]!.size, savedBytes: photo.sourceByteLength, gps: photo.sourceGps.normalized, utc: photo.sourceTime.capturedAtUtc, orientation: photo.sourceOrientation,
          width: thumb.width, height: thumb.height, pixel, expected: expectedTopRight[index], thumbnailExifGps: previewInfo.sourceGps.status,
          hasOriginalBlob: Object.values(photo).some(value => value instanceof Blob) });
      }
      const boundary = await orientedJpeg(await largeJpegBase(16000, 3750), 1, 'boundary-60mp.jpg');
      const over = await orientedJpeg(await largeJpegBase(16000, 4000), 1, 'over-64mp.jpg');
      const limits = await new PhotoImporter(db).importFiles([boundary, over], trip.id);
      let normalGuard = false; try { inspectImage(new Uint8Array(await files[0]!.arrayBuffer())); } catch { normalGuard = true; }
      const final = await db.snapshot(), zip = await exportArchive(final), inspected = await inspectArchive(zip);
      await restoreArchive(restoredDb, zip); const restored = await restoredDb.snapshot();
      return { rows, limits: limits.outcomes.map(value => value.state), normalGuard, inspected: inspected.photos.length, restored: restored.photos.length, original: final.photos.length };
    } finally { db.close(); restoredDb.close(); }
  });
  expect(result.limits).toEqual(['imported', 'failed']); expect(result.normalGuard).toBe(true);
  expect(result.original).toBe(9); expect(result.inspected).toBe(9); expect(result.restored).toBe(9);
  for (const [index, row] of result.rows.entries()) {
    expect(row.state).toBe('imported'); expect(row.before).toBe(row.after); expect(row.savedHash).toBe(row.before); expect(row.savedBytes).toBe(row.sourceBytes);
    expect(row.gps).toEqual({ latitude: 35.5, longitude: 139.5 }); expect(row.utc).toBe('2020-02-02T19:05:06.000Z'); expect(row.orientation).toBe(index + 1);
    expect([row.width, row.height]).toEqual(index < 4 ? [512, 96] : [96, 512]); expect(row.thumbnailExifGps).toBe('missing'); expect(row.hasOriginalBlob).toBe(false);
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(row.pixel[channel]! - row.expected![channel]!)).toBeLessThan(20);
  }
});

test('the existing file picker automatically imports a panorama without a second image or extra choice', async ({ page }) => {
  test.setTimeout(90_000); const external = await localUi(page); await page.goto('/'); await createTripUi(page, '合成：自動取り込み');
  await page.locator('#header-add').click();
  await page.evaluate(async () => {
    const { largeJpegBase, orientedJpeg } = await import('../../tests/e2e/helpers/automatic-jpeg-fixtures');
    const files = new DataTransfer(); files.items.add(await orientedJpeg(await largeJpegBase(), 6));
    const input = document.querySelector<HTMLInputElement>('#photo-files')!; input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  mkdirSync('test-results/automatic-jpeg', { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#import-options').evaluate((node: HTMLDetailsElement) => { node.open = true; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/automatic-jpeg/selected-${width}.png`, animations: 'disabled' });
  }
  await page.locator('#import-button').click();
  await expect(page.locator('#photo-import-dialog')).toHaveAttribute('data-import-state', 'done');
  await expect(page.locator('#import-status')).toContainText('追加 1枚');
  await page.locator('#import-done').click(); await photoListUi(page); await expect(page.locator('#photo-count')).toContainText('1枚');
  mkdirSync('test-results/automatic-jpeg', { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await photoListUi(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/automatic-jpeg/imported-${width}.png`, animations: 'disabled' });
  }
  expect(external).toEqual([]);
});

for (const [name, prefix] of [
  ['unsupported browser', 'globalThis.ImageDecoder=undefined;'],
  ['oversized coded frame', 'globalThis.ImageDecoder=class {static async isTypeSupported(){return true} async decode(){return {image:{codedWidth:16000,codedHeight:3000,displayWidth:512,displayHeight:96,visibleRect:{x:0,y:0,width:16000,height:3000},close(){}}}} close(){}};'],
  ['oversized display frame', 'globalThis.ImageDecoder=class {static async isTypeSupported(){return true} async decode(){return {image:{codedWidth:2000,codedHeight:375,displayWidth:16000,displayHeight:3000,visibleRect:{x:0,y:0,width:2000,height:375},close(){}}}} close(){}};'],
  ['invalid visible frame', 'globalThis.ImageDecoder=class {static async isTypeSupported(){return true} async decode(){return {image:{codedWidth:2000,codedHeight:375,displayWidth:2000,displayHeight:375,visibleRect:{x:0,y:0,width:4000,height:375},close(){}}}} close(){}};'],
] as const) {
  test(`${name} fails the new route without saving metadata-only and continues normal inputs`, async ({ page, context }) => {
    await context.route('**/automatic-jpeg.worker.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: prefix + '\n' + await response.text() }); });
    await page.goto('/fixtures/camera/manifest.json');
    const result = await page.evaluate(async () => {
      const { largeJpegBase, orientedJpeg } = await import('../../tests/e2e/helpers/automatic-jpeg-fixtures');
      const { PhotoImporter } = await import('../../src/application/import-photos');
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const { newTrip } = await import('../../src/domain/model');
      const db = await LibraryDb.open(`automatic-reject-${crypto.randomUUID()}`);
      try {
        const trip = newTrip('Synthetic guarded result'); await db.createTrip(trip);
        const large = await orientedJpeg(await largeJpegBase(), 1);
        const small = new File([await (await fetch('/fixtures/generated/png_no_metadata.png')).blob()], 'small.png');
        const report = await new PhotoImporter(db).importFiles([large, small], trip.id), snapshot = await db.snapshot();
        return { states: report.outcomes.map(value => value.state), names: snapshot.photos.map(photo => photo.originalFilename), thumbs: snapshot.thumbnails.length };
      } finally { db.close(); }
    });
    expect(result).toEqual({ states: ['failed', 'imported'], names: ['small.png'], thumbs: 1 });
  });
}

test('a native timeout interrupts the run, discards prepared files and blocks retry until reload', async ({ page, context }) => {
  await context.route('**/automatic-jpeg.worker.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: 'globalThis.ImageDecoder=class {static async isTypeSupported(){return true} decode(){return new Promise(()=>{})} close(){}};\n' + await response.text() });
  });
  await page.goto('/fixtures/camera/manifest.json');
  const result = await page.evaluate(async () => {
    const { largeJpegBase, orientedJpeg } = await import('../../tests/e2e/helpers/automatic-jpeg-fixtures');
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip } = await import('../../src/domain/model');
    const db = await LibraryDb.open(`automatic-timeout-${crypto.randomUUID()}`);
    try {
      const trip = newTrip('Synthetic timeout'); await db.createTrip(trip);
      const large = await orientedJpeg(await largeJpegBase(), 1), small = new File([await (await fetch('/fixtures/generated/png_no_metadata.png')).blob()], 'small.png');
      const native = window.createImageBitmap; let normalDecodes = 0;
      window.createImageBitmap = async () => { normalDecodes++; throw new Error('Normal decode must not start after timeout'); };
      const errors = [];
      try { await new PhotoImporter(db).importFiles([large, small], trip.id); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      try { await new PhotoImporter(db).importFiles([small], trip.id); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      window.createImageBitmap = native;
      const snapshot = await db.snapshot(), jobs = await db.listJobs();
      return { errors, normalDecodes, photos: snapshot.photos.length, thumbs: snapshot.thumbnails.length, jobs: jobs.map(job => ({ state: job.state, processed: job.processed })) };
    } finally { db.close(); }
  });
  expect(result.errors).toHaveLength(2); expect(result.errors.every(error => error.includes('再読み込み'))).toBe(true);
  expect(result.normalDecodes).toBe(0); expect(result.photos).toBe(0); expect(result.thumbs).toBe(0); expect(result.jobs).toEqual([{ state: 'interrupted', processed: 0 }]);
});

test('malformed envelope and Exif are rejected before the native decoder', async ({ page, context }) => {
  await context.route('**/automatic-jpeg.worker.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: 'globalThis.ImageDecoder=class {static async isTypeSupported(){globalThis.postMessage({unexpectedNativeCall:true});throw new Error("native must not run")}};\n' + await response.text() }); });
  await page.goto('/fixtures/camera/manifest.json');
  const result = await page.evaluate(async () => {
    const { largeJpegBase, orientedJpeg } = await import('../../tests/e2e/helpers/automatic-jpeg-fixtures');
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip } = await import('../../src/domain/model');
    const db = await LibraryDb.open(`automatic-invalid-${crypto.randomUUID()}`);
    try {
      const trip = newTrip('Synthetic invalid'); await db.createTrip(trip);
      const file = await orientedJpeg(await largeJpegBase(), 1), bytes = new Uint8Array(await file.arrayBuffer());
      const exif = bytes.slice(); new DataView(exif.buffer).setUint32(16, 0xfffffff0, exif[12] === 73);
      const report = await new PhotoImporter(db).importFiles([new File([exif], 'bad-exif.jpg'), new File([bytes.subarray(0, bytes.length - 2)], 'truncated.jpg')], trip.id);
      const snapshot = await db.snapshot(); return { states: report.outcomes.map(value => value.state), photos: snapshot.photos.length, thumbs: snapshot.thumbnails.length };
    } finally { db.close(); }
  });
  expect(result).toEqual({ states: ['failed', 'failed'], photos: 0, thumbs: 0 });
});

test('cancelling an active automatic import shows the reload instruction in the existing dialog', async ({ page, context }) => {
  await context.route('**/automatic-jpeg.worker.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: 'globalThis.ImageDecoder=class {static async isTypeSupported(){return true} decode(){return new Promise(()=>{})} close(){}};\n' + await response.text() });
  });
  await localUi(page); await page.goto('/'); await createTripUi(page, '合成：安全な中断');
  await page.locator('#header-add').click();
  await page.evaluate(async () => {
    const { largeJpegBase, orientedJpeg } = await import('../../tests/e2e/helpers/automatic-jpeg-fixtures');
    const files = new DataTransfer(); files.items.add(await orientedJpeg(await largeJpegBase(), 1));
    const input = document.querySelector<HTMLInputElement>('#photo-files')!; input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const worker = page.waitForEvent('worker', worker => worker.url().includes('automatic-jpeg.worker'));
  await page.locator('#import-button').click(); await worker;
  await page.locator('#cancel-button').click();
  await expect(page.locator('#import-status')).toContainText('取り込みを中断しました');
  await expect(page.locator('#import-status')).toContainText('再読み込み');
  await expect(page.locator('#import-status')).toContainText('追加 0枚');
});

test('a progress failure terminating an automatic worker retains the reload instruction and committed photo', async ({ page, context }) => {
  await context.route('**/automatic-jpeg.worker.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: 'globalThis.ImageDecoder=class {static async isTypeSupported(){return true} decode(){return new Promise(()=>{})} close(){}};\n' + await response.text() });
  });
  await page.goto('/fixtures/camera/manifest.json');
  const result = await page.evaluate(async () => {
    const { largeJpegBase, orientedJpeg } = await import('../../tests/e2e/helpers/automatic-jpeg-fixtures');
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip } = await import('../../src/domain/model');
    const db = await LibraryDb.open(`automatic-job-failure-${crypto.randomUUID()}`);
    try {
      const trip = newTrip('Synthetic cleanup'); await db.createTrip(trip);
      const large = await orientedJpeg(await largeJpegBase(), 1), small = new File([await (await fetch('/fixtures/generated/png_no_metadata.png')).blob()], 'small.png');
      const NativeWorker = window.Worker;
      let started!: () => void; const workerStarted = new Promise<void>(resolve => { started = resolve; });
      window.Worker = class extends NativeWorker { constructor(url: string | URL, options?: WorkerOptions) { super(url, options); if (String(url).includes('automatic-jpeg.worker')) started(); } };
      const saveJob = db.saveJob.bind(db);
      db.saveJob = async job => { if (job.processed) { await workerStarted; throw new Error('Synthetic progress failure'); } await saveJob(job); };
      const errors = [];
      try { await new PhotoImporter(db).importFiles([small, large], trip.id); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      try { await new PhotoImporter(db).importFiles([small], trip.id); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      window.Worker = NativeWorker;
      const snapshot = await db.snapshot(); return { errors, photos: snapshot.photos.map(photo => photo.originalFilename), thumbnails: snapshot.thumbnails.length };
    } finally { db.close(); }
  });
  expect(result.errors).toHaveLength(2); expect(result.errors.every(error => error.includes('再読み込み'))).toBe(true);
  expect(result.photos).toEqual(['small.png']); expect(result.thumbnails).toBe(1);
});
