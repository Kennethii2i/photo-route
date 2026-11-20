import { expect, test } from '@playwright/test';

test('cancel keeps completed Photos and marks remaining work cancelled', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const db = await LibraryDb.open(`phase4-cancel-${crypto.randomUUID()}`);
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!; const files: File[] = [];
    for (let index = 0; index < 20; index++) {
      context.fillStyle = `rgb(${index * 11},${index * 7},${index * 3})`; context.fillRect(0, 0, 16, 16);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encode failed')), 'image/png'));
      files.push(new File([blob], `cancel-${index}.png`, { type: 'image/png' }));
    }
    const importer = new PhotoImporter(db);
    const outcome = await importer.importFiles(files, null, progress => { if (progress.job.processed === 3) importer.cancel(); });
    const snapshot = await db.snapshot(), jobs = await db.listJobs(); db.close();
    return { imported: outcome.outcomes.filter(item => item.state === 'imported').length,
      cancelled: outcome.outcomes.filter(item => item.state === 'cancelled').length,
      saved: snapshot.photos.length, thumbnails: snapshot.thumbnails.length,
      state: jobs[0]?.state, processed: jobs[0]?.processed };
  });
  console.log('phase4-cancel', JSON.stringify(result));
  expect(result).toEqual({ imported: 3, cancelled: 17, saved: 3, thumbnails: 3, state: 'cancelled', processed: 20 });
});

test('closing the import page leaves committed Photos intact and records an interrupted job on restart', async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const dbName = `phase4-terminated-${crypto.randomUUID()}`;
  let release: () => void = () => undefined;
  const reachedTen = new Promise<void>(resolve => { release = resolve; });
  await page.exposeFunction('phase4ReachedTen', () => release());
  await page.evaluate(async name => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { PhotoImporter } = await import('../../src/application/import-photos');
    const db = await LibraryDb.open(name);
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!; const files: File[] = [];
    for (let index = 0; index < 300; index++) {
      context.fillStyle = `rgb(${index & 255},${(index >> 8) & 255},${(index * 71) & 255})`;
      context.fillRect(0, 0, 16, 16);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encode failed')), 'image/png'));
      files.push(new File([blob], `terminated-${index}.png`, { type: 'image/png' }));
    }
    void new PhotoImporter(db).importFiles(files, null, progress => {
      if (progress.job.processed === 10) void (window as unknown as { phase4ReachedTen: () => Promise<void> }).phase4ReachedTen();
    });
  }, dbName);
  await reachedTen;
  await page.close();
  const resumed = await context.newPage(); await resumed.goto('/');
  const result = await resumed.evaluate(async name => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { validateRelations } = await import('../../src/domain/model');
    const db = await LibraryDb.open(name);
    const before = await db.listJobs(); await db.markInterruptedJobs();
    const after = await db.listJobs(), snapshot = await db.snapshot();
    validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
    db.close();
    return { beforeState: before[0]?.state, afterState: after[0]?.state,
      processed: after[0]?.processed, photos: snapshot.photos.length, thumbnails: snapshot.thumbnails.length };
  }, dbName);
  console.log('phase4-page-termination', JSON.stringify(result));
  expect(result.beforeState).toBe('running');
  expect(result.afterState).toBe('interrupted');
  expect(result.photos).toBeGreaterThanOrEqual(10);
  expect(result.photos).toBeLessThan(300);
  expect(result.thumbnails).toBe(result.photos);
});
