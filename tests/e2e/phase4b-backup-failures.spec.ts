import { expect, test } from '@playwright/test';
import { zipSync, unzipSync } from 'fflate';

test('stream cancellation and simulated quota or memory failure keep the previously saved file', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { newTrip } = await import('../../src/domain/model');
    const { streamArchive } = await import('../../src/infrastructure/archive');
    const snapshot = { trips: [newTrip('Protected backup')], visits: [], photos: [], thumbnails: [], links: [] };
    const root = await navigator.storage.getDirectory();
    const results = [];
    for (const mode of ['cancel', 'quota', 'memory'] as const) {
      const handle = await root.getFileHandle(`phase4b-failure-${mode}-${crypto.randomUUID()}.zip`, { create: true });
      const original = await handle.createWritable(); await original.write('existing independent backup'); await original.close();
      const fileWriter = await handle.createWritable(); const controller = new AbortController();
      let writes = 0, aborted = false, errorName = '';
      const stream = new WritableStream<Uint8Array>({
        async write(chunk) {
          writes++;
          if (writes === 4 && mode === 'cancel') controller.abort();
          if (writes === 4 && mode === 'quota') throw new DOMException('quota', 'QuotaExceededError');
          if (writes === 4 && mode === 'memory') throw new RangeError('simulated allocation failure');
          await fileWriter.write(new Uint8Array(chunk));
        },
        async close() { await fileWriter.close(); },
        async abort() { aborted = true; await fileWriter.abort(); },
      });
      try { await streamArchive(snapshot, stream, { signal: controller.signal }); }
      catch (error) { errorName = error instanceof Error ? error.name : String(error); await fileWriter.abort().catch(() => undefined); }
      results.push({ mode, writes, aborted, errorName, retained: await (await handle.getFile()).text() });
    }
    return results;
  });
  console.log('phase4b-write-failures', JSON.stringify(result));
  expect(result.map(item => item.retained)).toEqual(Array(3).fill('existing independent backup'));
  expect(result.map(item => item.errorName)).toEqual(['AbortError', 'QuotaExceededError', 'RangeError']);
  expect(result.every(item => item.writes >= 4)).toBe(true);
});

test('cancelled or corrupt restore rejects before mutation and accepts legacy v1 ZIP', async ({ page }) => {
  await page.goto('/');
  const generated = await page.evaluate(async () => {
    const { newTrip } = await import('../../src/domain/model');
    const incoming = { trips: [newTrip('Legacy transfer')], visits: [], photos: [], thumbnails: [], links: [] };
    const { exportArchive } = await import('../../src/infrastructure/archive');
    const modern = await exportArchive(incoming);
    return { incomingId: incoming.trips[0]!.id, modernBytes: Array.from(new Uint8Array(await modern.arrayBuffer())) };
  });
  const entries = unzipSync(new Uint8Array(generated.modernBytes));
  delete entries['records/photo-album-links.json'];
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as { version: number; entries: Array<{ path: string }> };
  manifest.version = 1;
  manifest.entries = manifest.entries.filter(entry => entry.path !== 'records/photo-album-links.json');
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  const legacyBytes = Array.from(zipSync(entries, { level: 0 }));
  const deflatedBytes = Array.from(zipSync(entries, { level: 6 }));
  const bombBytes = new Uint8Array(zipSync({ ...entries, 'records/trips.json': new Uint8Array(1024 * 1024).fill(65) }, { level: 9 }));
  const bombView = new DataView(bombBytes.buffer);
  let changed = 0;
  for (let offset = 0; offset < bombBytes.length - 46; offset++) {
    const signature = bombView.getUint32(offset, true);
    if (signature !== 0x04034b50 && signature !== 0x02014b50) continue;
    const nameLength = bombView.getUint16(offset + (signature === 0x04034b50 ? 26 : 28), true);
    const nameOffset = offset + (signature === 0x04034b50 ? 30 : 46);
    if (new TextDecoder().decode(bombBytes.subarray(nameOffset, nameOffset + nameLength)) !== 'records/trips.json') continue;
    bombView.setUint32(offset + (signature === 0x04034b50 ? 22 : 24), 10, true); changed++;
  }
  expect(changed).toBe(2);
  const result = await page.evaluate(async ({ incomingId, modernBytes, legacyBytes, deflatedBytes, bombBytes }) => {
    const { newTrip } = await import('../../src/domain/model');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { inspectArchive, restoreArchive } = await import('../../src/infrastructure/archive');
    const modern = new Blob([new Uint8Array(modernBytes)], { type: 'application/zip' });
    const legacy = new Blob([new Uint8Array(legacyBytes)], { type: 'application/zip' });
    const legacyRead = await inspectArchive(legacy);
    const deflatedRead = await inspectArchive(new Blob([new Uint8Array(deflatedBytes)], { type: 'application/zip' }));
    const db = await LibraryDb.open(`phase4b-restore-failure-${crypto.randomUUID()}`);
    const retained = newTrip('Retained Trip'); await db.createTrip(retained);
    const controller = new AbortController(); let slices = 0;
    const cancelling = new Blob([new Uint8Array(await modern.arrayBuffer())], { type: 'application/zip' });
    const originalSlice = cancelling.slice.bind(cancelling);
    cancelling.slice = (start?: number, end?: number, type?: string) => {
      if (++slices === 3) controller.abort();
      return originalSlice(start, end, type);
    };
    let cancelled = '';
    try { await restoreArchive(db, cancelling, 'reject-conflicts', controller.signal); }
    catch (error) { cancelled = error instanceof Error ? error.name : String(error); }
    const broken = new Uint8Array(await modern.arrayBuffer()); broken[45] = broken[45]! ^ 0xff;
    let corrupt = '';
    try { await restoreArchive(db, new Blob([broken], { type: 'application/zip' })); }
    catch (error) { corrupt = error instanceof Error ? error.message : String(error); }
    let bomb = '';
    try { await restoreArchive(db, new Blob([new Uint8Array(bombBytes)], { type: 'application/zip' })); }
    catch (error) { bomb = error instanceof Error ? error.message : String(error); }
    const before = await db.snapshot();
    const restored = await restoreArchive(db, legacy);
    const after = await db.snapshot(); db.close();
    return { legacyTrips: legacyRead.trips.length, deflatedTrips: deflatedRead.trips.length, cancelled, corrupt, bomb, beforeTrips: before.trips.map(trip => trip.id),
      beforePhotos: before.photos.length, restoredState: restored.state, afterTrips: after.trips.map(trip => trip.id),
      incomingId, retainedId: retained.id };
  }, { ...generated, legacyBytes, deflatedBytes, bombBytes: Array.from(bombBytes) });
  console.log('phase4b-read-failures', JSON.stringify(result));
  expect(result.legacyTrips).toBe(1);
  expect(result.deflatedTrips).toBe(1);
  expect(result.cancelled).toBe('AbortError');
  expect(result.corrupt.length).toBeGreaterThan(0);
  expect(result.bomb).toContain('ZIP展開サイズが宣言値を超えています');
  expect(result.beforeTrips).toEqual([result.retainedId]);
  expect(result.beforePhotos).toBe(0);
  expect(result.restoredState).toBe('imported');
  expect(result.afterTrips).toEqual(expect.arrayContaining([result.retainedId, result.incomingId]));
});

test('the direct-save button writes a checked ZIP through a file stream when available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () =>
      (await navigator.storage.getDirectory()).getFileHandle('phase4b-ui-backup.zip', { create: true }) });
  });
  await page.goto('/');
  await page.locator('#header-manage').click();
  await page.locator('#trip-name').fill('Direct save trial');
  await page.getByRole('button', { name: '旅行を作成' }).click();
  await page.locator('#manage-archive').click();
  await page.locator('#stream-export-button').click();
  await expect(page.locator('#archive-status')).toContainText('端末へ保存して内容を再検証しました');
  const result = await page.evaluate(async () => {
    const { inspectArchive } = await import('../../src/infrastructure/archive');
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('phase4b-ui-backup.zip');
    const file = await handle.getFile(), snapshot = await inspectArchive(file);
    return { bytes: file.size, trips: snapshot.trips.map(trip => trip.name) };
  });
  expect(result.bytes).toBeGreaterThan(0);
  expect(result.trips).toEqual(['Direct save trial']);
});

test('quota failure or cancellation during the restore transaction rolls back every incoming record', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { newTrip, photoSchema } = await import('../../src/domain/model');
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { exportArchive, restoreArchive } = await import('../../src/infrastructure/archive');
    const trip = newTrip('Incoming Trip');
    const photos = Array.from({ length: 50 }, (_, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: `incoming-${index}.jpg`,
      sourceMime: 'image/jpeg', sourceByteLength: 100, contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
      gpsCorrection: null, sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null,
        rawGpsTimeStamp: null, localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [],
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null }));
    const archive = await exportArchive({ trips: [trip], visits: [], photos, thumbnails: [], links: [] });
    const outcomes = [];
    for (const mode of ['cancel', 'quota'] as const) {
      const db = await LibraryDb.open(`phase4b-transaction-${mode}-${crypto.randomUUID()}`);
      const retained = newTrip('Retained Trip'); await db.createTrip(retained);
      const controller = new AbortController(); const originalAdd = IDBObjectStore.prototype.add;
      let adds = 0, errorName = '';
      IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
        if (this.name === 'photos' && ++adds === 10) {
          if (mode === 'cancel') controller.abort();
          else throw new DOMException('quota', 'QuotaExceededError');
        }
        return originalAdd.call(this, value, key);
      };
      try { await restoreArchive(db, archive, 'reject-conflicts', controller.signal); }
      catch (error) { errorName = error instanceof Error ? error.name : String(error); }
      finally { IDBObjectStore.prototype.add = originalAdd; }
      const snapshot = await db.snapshot(); db.close();
      outcomes.push({ mode, adds, errorName, trips: snapshot.trips.map(item => item.id), photos: snapshot.photos.length,
        retainedId: retained.id });
    }
    return outcomes;
  });
  console.log('phase4b-transaction-failures', JSON.stringify(result));
  expect(result.map(item => item.photos)).toEqual([0, 0]);
  expect(result.every(item => item.trips.length === 1 && item.trips[0] === item.retainedId)).toBe(true);
  expect(result.map(item => item.errorName)).toEqual(['AbortError', 'QuotaExceededError']);
});

test('the buffered download remains available when direct save is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }));
  await page.goto('/');
  await page.locator('#header-manage').click();
  await page.locator('#trip-name').fill('Fallback backup');
  await page.getByRole('button', { name: '旅行を作成' }).click();
  await page.locator('#manage-archive').click();
  await expect(page.locator('#stream-export-button')).toBeHidden();
  const download = page.waitForEvent('download');
  await page.locator('#export-button').click();
  expect((await download).suggestedFilename()).toMatch(/^photo-route-.*\.zip$/);
  await expect(page.locator('#archive-status')).toContainText('書き出しを開始しました');
});

test('the direct-save cancel button stops an in-progress stream', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { writes: 0, aborted: false };
    (window as unknown as { phase4bSaveState: typeof state }).phase4bSaveState = state;
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({
      createWritable: async () => new WritableStream<Uint8Array>({
        async write() { state.writes++; await new Promise(resolve => window.setTimeout(resolve, 100)); },
        abort() { state.aborted = true; },
      }),
      getFile: async () => new File([], 'should-not-be-committed.zip'),
    }) });
  });
  await page.goto('/');
  await page.locator('#header-manage').click();
  await page.locator('#trip-name').fill('Cancelled backup');
  await page.getByRole('button', { name: '旅行を作成' }).click();
  await page.locator('#manage-archive').click();
  await page.locator('#stream-export-button').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { phase4bSaveState: { writes: number } }).phase4bSaveState.writes)).toBeGreaterThan(0);
  await page.locator('#archive-cancel').click();
  await expect(page.locator('#archive-status')).toContainText('ZIP処理を中断しました');
  expect(await page.evaluate(() => (window as unknown as { phase4bSaveState: { aborted: boolean } }).phase4bSaveState.aborted)).toBe(true);
});
