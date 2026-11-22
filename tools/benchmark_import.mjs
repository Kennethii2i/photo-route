// Optional local probe; install Playwright Chromium and generate the synthetic
// input with generate_import_benchmark.py. No real photos or existing DBs.
/* global process, console, URL, window, document, File, crypto, performance, fetch, navigator */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const count = Number(process.env.PHOTO_ROUTE_BENCH_COUNT ?? 48);
const rounds = Number(process.env.PHOTO_ROUTE_BENCH_ROUNDS ?? 3);
const port = Number(process.env.PHOTO_ROUTE_BENCH_PORT ?? 18262);
if (!Number.isInteger(count) || count < 1 || count > 1000 || !Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error('Invalid benchmark size');
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [5173, 18260].includes(port)) throw new Error('Use an unused dedicated port');
const origin = `http://127.0.0.1:${port}`;
const source = await readFile(resolve('coverage/import-benchmark-24mp.jpg'));
const server = await createServer({ cacheDir: 'coverage/import-vite-cache', server: { host: '127.0.0.1', port, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().url() === `${origin}/synthetic-benchmark.jpg`
    ? route.fulfill({ body: source, contentType: 'image/jpeg' })
    : new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`${origin}/fixtures/camera/manifest.json`);
  await page.exposeFunction('reportSyntheticRun', value => console.log(JSON.stringify(value)));
  const result = await page.evaluate(async ({ count, rounds }) => {
    const { PhotoImporter } = await import('/src/application/import-photos.ts');
    const { LibraryDb } = await import('/src/infrastructure/storage.ts');
    const { sha256 } = await import('/src/infrastructure/image.ts');
    const source = await (await fetch('/synthetic-benchmark.jpg')).blob();
    const files = Array.from({ length: count }, (_, index) => new File([
      source.slice(0, 2), new Uint8Array([255, 254, 0, 6, 0, 0, index >> 8, index & 255]), source.slice(2),
    ], `synthetic-${index}.jpg`, { type: 'image/jpeg' }));
    let reference;
    const runs = [];
    for (let round = 0; round < rounds; round++) {
      for (const concurrency of round % 2 ? [2, 1] : [1, 2]) {
        const db = await LibraryDb.open(`synthetic-benchmark-${crypto.randomUUID()}`);
        const now = new Date().toISOString();
        const trip = { id: crypto.randomUUID(), name: 'Synthetic benchmark', createdAt: now, updatedAt: now, deletedAt: null };
        try {
          await db.createTrip(trip);
          let rendered = 0;
          const list = document.createElement('ul'); document.body.replaceChildren(list);
          const started = performance.now();
          const report = await new PhotoImporter(db, concurrency).importFiles(files, trip.id, progress => {
            for (const outcome of progress.outcomes.slice(rendered)) {
              const item = document.createElement('li'); item.textContent = `${outcome.filename}: ${outcome.state}`; list.append(item);
            }
            rendered = progress.outcomes.length;
          });
          const elapsedMs = performance.now() - started;
          if (report.job.processed !== count || report.outcomes.some(item => item.state !== 'imported')) throw new Error('Unexpected import result');
          const snapshot = await db.snapshot();
          if (snapshot.photos.length !== count || snapshot.thumbnails.length !== count) throw new Error('Invalid saved counts');
          const thumbs = new Map(snapshot.thumbnails.map(thumb => [thumb.id, thumb]));
          const fingerprint = [];
          for (const photo of snapshot.photos.sort((a, b) => a.originalFilename.localeCompare(b.originalFilename))) {
            const thumb = thumbs.get(photo.thumbnailId);
            if (!thumb || thumb.photoId !== photo.id || thumb.width > 512 || thumb.height > 512) throw new Error('Invalid thumbnail');
            fingerprint.push({ name: photo.originalFilename, hash: photo.contentSha256, gps: photo.sourceGps, time: photo.sourceTime,
              orientation: photo.sourceOrientation, issues: photo.metadataIssues, width: thumb.width, height: thumb.height,
              thumbnailHash: await sha256(new Uint8Array(await thumb.blob.arrayBuffer())) });
          }
          const serialized = JSON.stringify(fingerprint);
          reference ??= serialized;
          if (serialized !== reference) throw new Error('Serial and parallel output differs');
          const run = { round, concurrency, count, elapsedMs, equivalent: true };
          runs.push(run); await window.reportSyntheticRun(run);
        } finally { db.close(); }
      }
    }
    return { sourceBytes: source.size, width: 6000, height: 4000, count, rounds, userAgent: navigator.userAgent, runs,
      note: 'Unique JPEG COM variants of the same synthetic pixels. Fresh dedicated DB per run. Includes importer and result list, excludes file picker, real-disk I/O and app final map/library render. Scheduling budgets are not whole-browser memory limits.' };
  }, { count, rounds });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const destination = resolve('coverage', `import-benchmark-${count}-${stamp}-${crypto.randomUUID()}.json`);
  await writeFile(destination, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(`Saved ${destination}`);
} finally { await browser?.close(); await server.close(); }
