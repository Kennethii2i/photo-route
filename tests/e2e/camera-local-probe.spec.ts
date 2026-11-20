import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

async function memory(browser: Browser): Promise<{ workingSetMiB: number; summedPeakMiB: number; processCount: number } | null> {
  if (process.platform !== 'win32') return null;
  const session = await browser.newBrowserCDPSession();
  try {
    const result = await session.send('SystemInfo.getProcessInfo') as { processInfo: { id: number }[] };
    const ids = result.processInfo.map(x => x.id).filter(Number.isSafeInteger);
    if (!ids.length) return null;
    const script = `$p = @(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue); [pscustomobject]@{workingSetMiB = [math]::Round((($p | Measure-Object WorkingSet64 -Sum).Sum / 1MB), 1); summedPeakMiB = [math]::Round((($p | Measure-Object PeakWorkingSet64 -Sum).Sum / 1MB), 1); processCount = $p.Count} | ConvertTo-Json -Compress`;
    return JSON.parse(execFileSync('pwsh.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })) as { workingSetMiB: number; summedPeakMiB: number; processCount: number };
  } finally { await session.detach(); }
}

async function importAndMeasure(page: Page, browser: Browser, files: string[]) {
  const external: string[] = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:5184/') || url.startsWith('blob:http://127.0.0.1:5184/')) void route.continue();
    else { external.push(url); void route.abort(); }
  });
  await page.goto('/');
  const before = await memory(browser);
  await page.locator('#photo-files').setInputFiles(files);
  const started = Date.now();
  await page.getByRole('button', { name: '選択した写真を取り込む' }).click();
  await expect(page.locator('#import-status')).toContainText(`${files.length}/${files.length}件を処理（completed）`, { timeout: 240_000 });
  const elapsedMs = Date.now() - started;
  const after = await memory(browser);
  const result = await page.evaluate(async () => {
    const storageUrl = '/src/infrastructure/storage.ts';
    const { LibraryDb } = await import(storageUrl) as typeof import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    const photos = await db.listPhotos();
    const thumbs = await db.listThumbnails();
    db.close();
    return { photoCount: photos.length, thumbnailCount: thumbs.length,
      jsHeapMiB: Math.round(((performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576) };
  });
  expect(external).toEqual([]);
  return { elapsedMs, before, after, ...result, status: await page.locator('#import-status').textContent() };
}

test('optional 48MP high-entropy JPEG local memory probe', async ({ page, browser }) => {
  test.skip(!process.env.CAMERA_BENCHMARK_FILE, 'Set CAMERA_BENCHMARK_FILE to a local synthetic JPEG');
  test.setTimeout(300_000);
  const result = await importAndMeasure(page, browser, [process.env.CAMERA_BENCHMARK_FILE!]);
  console.log('synthetic-48mp-benchmark', JSON.stringify(result));
  expect(result.photoCount).toBe(1);
  expect(result.thumbnailCount).toBe(1);
  expect(result.status).toContain('成功 1件、部分成功 0件');
});

test('optional user JPEG batch local-only smoke', async ({ page, browser }) => {
  test.skip(!process.env.PHOTO_PROBE_DIR, 'Set PHOTO_PROBE_DIR to a local folder with JPEG files');
  test.setTimeout(300_000);
  const files = readdirSync(process.env.PHOTO_PROBE_DIR!).filter(name => /\.jpe?g$/i.test(name)).sort().map(name => join(process.env.PHOTO_PROBE_DIR!, name)).filter(path => statSync(path).isFile());
  expect(files).toHaveLength(10);
  const result = await importAndMeasure(page, browser, files);
  console.log('user-jpeg-batch', JSON.stringify(result));
  expect(result.photoCount).toBe(10);
  expect(result.thumbnailCount).toBe(10);
  expect(result.status).toContain('成功 10件、部分成功 0件');
});
