import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

for (const count of [1_000, 5_000]) {
  test(`${count} realistic thumbnails and larger Exif survive streamed backup and restore`, async ({ page, browser }) => {
    test.setTimeout(600_000);
    const origin = test.info().project.use.baseURL as string;
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
    await page.goto('/');
    const browserMiB = async (): Promise<number | null> => {
      try {
        const session = await browser.newBrowserCDPSession();
        const { processInfo } = await session.send('SystemInfo.getProcessInfo') as { processInfo: { id: number }[] };
        await session.detach();
        const ids = processInfo.map(item => item.id).filter(id => Number.isInteger(id));
        if (!ids.length) return null;
        const script = `$p = @(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue); [math]::Round((($p | Measure-Object WorkingSet64 -Sum).Sum / 1MB), 1)`;
        const value = Number(execFileSync('pwsh.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim());
        return Number.isFinite(value) ? value : null;
      } catch { return null; }
    };
    const browserBeforeMiB = await browserMiB();
    let browserPeakMiB = browserBeforeMiB;
    const browserSamples: number[] = [];
    const sampleBrowser = async () => {
      const value = await browserMiB();
      if (value !== null) {
        browserSamples.push(value);
        browserPeakMiB = Math.max(browserPeakMiB ?? 0, value);
      }
    };
    const browserSampleTimer = count === 5_000 ? setInterval(() => { void sampleBrowser(); }, 3_000) : null;
    const metrics = await page.evaluate(async count => {
      const { newTrip, photoSchema, validateAlbumLinks, validateRelations } = await import('../../src/domain/model');
      const { newVisit } = await import('../../src/domain/visits');
      const { sourceClockEvidence } = await import('../../src/domain/time');
      const { LibraryDb } = await import('../../src/infrastructure/storage');
      const { streamArchive, restoreArchive } = await import('../../src/infrastructure/archive');
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
      const context = canvas.getContext('2d')!;
      const pixels = context.createImageData(240, 160); let random = 827;
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        random = Math.imul(random, 1664525) + 1013904223;
        pixels.data[offset] = random & 255; pixels.data[offset + 1] = random >>> 8 & 255;
        pixels.data[offset + 2] = random >>> 16 & 255; pixels.data[offset + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode failed')), 'image/jpeg', .82));
      const trip = newTrip('D1合成バックアップ'), visit = newVisit(trip.id, 'D1合成Visit');
      const exifValue = 'synthetic-exif-'.repeat(300);
      const clock = sourceClockEvidence('2020:02:03 04:05:06', '+09:00');
      const photos = Array.from({ length: count }, (_, index) => photoSchema.parse({
        id: crypto.randomUUID(), tripId: trip.id, visitId: null,
        originalFilename: `d1-${index}.jpg`, sourceMime: 'image/jpeg', sourceByteLength: 4_000_000,
        contentSha256: index.toString(16).padStart(64, '0'),
        sourceGps: { rawTags: { SyntheticExif: exifValue }, normalized: { latitude: 32.7, longitude: 129.8 },
          horizontalErrorMeters: 2, datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null,
        sourceTime: { ...clock, rawDateTimeOriginal: '2020:02:03 04:05:06', rawOffsetTimeOriginal: '+09:00',
          rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] }, timeCorrection: null, sourceOrientation: 6,
        thumbnailId: crypto.randomUUID(), thumbnailState: 'available', metadataIssues: [],
        importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
      }));
      const thumbnails = photos.map(photo => ({ id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg' as const,
        width: 240, height: 160, byteLength: blob.size, blob }));
      const links = photos.slice(0, 10).map(photo => ({ albumId: visit.id, photoId: photo.id, createdAt: null }));
      const snapshot = { trips: [trip], visits: [visit], photos, thumbnails, links };
      validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
      validateAlbumLinks(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.links);
      const sourceDbName = `d1-source-${crypto.randomUUID()}`;
      const db = await LibraryDb.open(sourceDbName);
      const seedStart = performance.now(); await db.restoreNew(snapshot); const seedMs = Math.round(performance.now() - seedStart);
      db.close();
      const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
      const heapBefore = heap(); let heapPeak = heapBefore ?? 0;
      const timer = window.setInterval(() => { heapPeak = Math.max(heapPeak, heap() ?? 0); }, 20);
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(`d1-${count}-${crypto.randomUUID()}.zip`, { create: true });
      const start = performance.now();
      const written = await streamArchive(snapshot, await handle.createWritable());
      const exportMs = Math.round(performance.now() - start);
      const target = await LibraryDb.open(`d1-target-${crypto.randomUUID()}`);
      const restored = await restoreArchive(target, await handle.getFile());
      const saved = await target.snapshot(); target.close(); window.clearInterval(timer);
      validateRelations(saved.trips, saved.visits, saved.photos, saved.thumbnails);
      validateAlbumLinks(saved.trips, saved.visits, saved.photos, saved.links);
      const first = saved.photos.find(photo => photo.id === photos[0]!.id)!;
      return { count, sourceDbName, thumbnailBytes: blob.size, exifChars: exifValue.length, seedMs, exportMs,
        exportRestoreMs: Math.round(performance.now() - start), zipBytes: written, heapBefore, heapPeak, heapAfter: heap(),
        state: restored.state, photos: saved.photos.length, thumbnails: saved.thumbnails.length,
        sameLinks: saved.links.length === links.length && saved.links.some(link => link.photoId === first.id && link.albumId === visit.id),
        sameGps: JSON.stringify(first.sourceGps) === JSON.stringify(photos[0]!.sourceGps),
        sameTime: JSON.stringify(first.sourceTime) === JSON.stringify(photos[0]!.sourceTime),
        sameExif: first.sourceGps.rawTags.SyntheticExif === exifValue,
      };
    }, count);
    if (browserSampleTimer) clearInterval(browserSampleTimer);
    const browserAfterMiB = await browserMiB();
    const memoryTimeline: Record<string, unknown> = { browserBeforeMiB, browserPeakMiB, browserAfterMiB,
      browserSampleCount: browserSamples.length };
    if (count === 5_000) {
      const heapMiB = () => page.evaluate(() => {
        const value = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
        return value === undefined ? null : Math.round(value / 1048576);
      });
      await page.waitForTimeout(30_000);
      memoryTimeline.after30s = { browserMiB: await browserMiB(), heapMiB: await heapMiB() };
      await page.waitForTimeout(90_000);
      memoryTimeline.after2min = { browserMiB: await browserMiB(), heapMiB: await heapMiB() };
      const repeat = await page.evaluate(async sourceDbName => {
        const { LibraryDb } = await import('../../src/infrastructure/storage');
        const { streamArchive, restoreArchive } = await import('../../src/infrastructure/archive');
        const source = await LibraryDb.open(sourceDbName);
        const snapshot = await source.snapshot(); source.close();
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(`d2-repeat-${crypto.randomUUID()}.zip`, { create: true });
        const start = performance.now();
        const bytes = await streamArchive(snapshot, await handle.createWritable());
        const target = await LibraryDb.open(`d2-repeat-${crypto.randomUUID()}`);
        const restored = await restoreArchive(target, await handle.getFile());
        const saved = await target.snapshot(); target.close();
        return { ms: Math.round(performance.now() - start), bytes, state: restored.state,
          photos: saved.photos.length, thumbnails: saved.thumbnails.length };
      }, metrics.sourceDbName);
      memoryTimeline.repeat = { ...repeat, browserMiB: await browserMiB(), heapMiB: await heapMiB() };
      expect(repeat).toMatchObject({ state: 'imported', photos: count, thumbnails: count });
      expect(repeat.bytes).toBe(metrics.zipBytes);
      await page.waitForTimeout(30_000);
      memoryTimeline.repeatAfter30s = { browserMiB: await browserMiB(), heapMiB: await heapMiB() };
      await page.waitForTimeout(90_000);
      memoryTimeline.repeatAfter2min = { browserMiB: await browserMiB(), heapMiB: await heapMiB() };
      await page.close();
      memoryTimeline.afterPageCloseMiB = await browserMiB();
    }
    console.log(`phase5d1-archive-${count}`, JSON.stringify({ ...metrics, ...memoryTimeline }));
    expect(metrics).toMatchObject({ count, state: 'imported', photos: count, thumbnails: count,
      sameLinks: true, sameGps: true, sameTime: true, sameExif: true });
    expect(metrics.thumbnailBytes).toBeGreaterThan(20_000);
  });
}
