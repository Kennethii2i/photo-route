import { readFileSync } from 'node:fs';
import ExifReader from 'exifreader';
import { expect, test } from '@playwright/test';

test('P0-T04 follow-up identifies bundled codec versions at runtime', async ({ page }) => {
  await page.goto('/spikes/p0-t04-followup/version.html');
  await page.waitForFunction(() => Boolean((window as Window & { p0HeicVersions?: unknown }).p0HeicVersions), undefined, { timeout: 20_000 });
  const versions = await page.evaluate(() => (window as Window & { p0HeicVersions?: unknown }).p0HeicVersions);
  const buildHeader = readFileSync('node_modules/heic-to/src/lib/libheif.js', 'utf8').slice(0, 90);
  console.log(`P0-T04 follow-up versions ${JSON.stringify({ versions, buildHeader })}`);
  expect(versions).not.toHaveProperty('error');
  expect(versions).toHaveProperty('heifRaw', 0x01170700); // 1.23.7.0
  expect(buildHeader).toContain('libheif 1.23.7');
  expect(buildHeader).toContain('LIBDE265_VERSION=1.0.16');
});

test('P0-T04 follow-up decodes synthetic HEIC locally with bounded output', async ({ page }) => {
  test.setTimeout(60_000);
  const requests: string[] = [];
  page.on('request', request => requests.push(`${request.method()} ${request.url()}`));
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5184' ? route.continue() : route.abort());
  await page.goto('/spikes/p0-t04-followup/probe.html');
  await page.waitForFunction(() => Boolean(window.p0HeicProbe));
  for (const path of ['fixtures/heif/synthetic_gps_offset_orientation.heic', 'fixtures/heif/synthetic_no_metadata.heif']) {
    const bytes = Array.from(readFileSync(path));
    const sourceTags = await ExifReader.load(new Uint8Array(bytes), { expanded: true });
    const result = await page.evaluate(async ({ data, mime }) => window.p0HeicProbe!.convert(new Uint8Array(data), mime), { data: bytes, mime: path.endsWith('.heic') ? 'image/heic' : 'image/heif' });
    console.log(`P0-T04 follow-up ${path} ${JSON.stringify({ ...result, thumbnailBytes: result.thumbnailBytes?.length })}`);
    expect(result.status).toBe('ok');
    expect(Math.max(result.thumbnailWidth ?? 0, result.thumbnailHeight ?? 0)).toBeLessThanOrEqual(8);
    if (path.endsWith('.heic')) {
      expect(sourceTags.exif?.Orientation?.value).toBe(6);
      expect([result.width, result.height]).toEqual([12, 16]);
      expect((result.topRight?.[0] ?? 0) - (result.topRight?.[1] ?? 0)).toBeGreaterThan(100);
    } else {
      expect([result.width, result.height]).toEqual([16, 12]);
      expect((result.topLeft?.[0] ?? 0) - (result.topLeft?.[1] ?? 0)).toBeGreaterThan(100);
    }
    const tags = await ExifReader.load(new Uint8Array(result.thumbnailBytes ?? []), { expanded: true });
    expect(tags.exif?.GPSLatitude).toBeUndefined();
    expect(tags.exif?.DateTimeOriginal).toBeUndefined();
  }
  const external = requests.filter(value => !value.includes('127.0.0.1:5184'));
  console.log(`P0-T04 follow-up network ${JSON.stringify({ count: requests.length, external })}`);
  expect(external).toEqual([]);
});

test('P0-T04 follow-up rejects oversized and damaged synthetic inputs', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/spikes/p0-t04-followup/probe.html');
  await page.waitForFunction(() => Boolean(window.p0HeicProbe));
  const bytes = Array.from(readFileSync('fixtures/heif/synthetic_gps_offset_orientation.heic'));
  const result = await page.evaluate(async data => {
    const probe = window.p0HeicProbe!;
    const oversized = await probe.preflight(new Blob(Array.from({ length: 9 }, () => new Uint8Array(1024 * 1024)))).then(() => 'accepted', error => String(error));
    const signature = await probe.convert(new Uint8Array([1, 2, 3]), 'image/heic');
    const truncated = await probe.convert(new Uint8Array(data.slice(0, 400)), 'image/heic');
    const hugePixels = new Uint8Array(data);
    const marker = hugePixels.findIndex((_, i) => String.fromCharCode(...hugePixels.slice(i, i + 4)) === 'ispe');
    if (marker >= 0) new DataView(hugePixels.buffer).setUint32(marker + 8, 50_000);
    const pixels = await probe.convert(hugePixels, 'image/heic');
    const recovered = await probe.convert(new Uint8Array(data), 'image/heic');
    return { oversized, signature, truncated, pixels, recovered: { status: recovered.status, width: recovered.width, height: recovered.height } };
  }, bytes);
  console.log(`P0-T04 follow-up failures ${JSON.stringify(result)}`);
  expect(result.oversized).toContain('source byte limit');
  expect(result.signature.status).toBe('failed');
  expect(result.truncated.status).toBe('failed');
  expect(result.pixels.reason).toContain('declared pixel limit');
  expect(result.recovered).toEqual({ status: 'ok', width: 12, height: 16 });
});

test('P0-T04 follow-up probes native and WebCodecs without a WASM fallback', async ({ page }) => {
  await page.goto('/spikes/p0-t04-followup/platform.html');
  await page.waitForFunction(() => Boolean(window.p0PlatformProbe));
  const support = await page.evaluate(() => window.p0PlatformProbe!.support());
  const imageDecoderSupport = await page.evaluate(async () => {
    const decoder = (window as Window & { ImageDecoder?: { isTypeSupported(type: string): Promise<boolean> } }).ImageDecoder;
    return decoder ? { heic: await decoder.isTypeSupported('image/heic'), heif: await decoder.isTypeSupported('image/heif') } : null;
  });
  const data = Array.from(readFileSync('fixtures/heif/synthetic_gps_offset_orientation.heic'));
  const result = await page.evaluate(bytes => window.p0PlatformProbe!.decode(new Uint8Array(bytes)), data);
  console.log(`P0-T04 follow-up platform ${JSON.stringify({ support, imageDecoderSupport, result })}`);
  expect(['ok', 'failed']).toContain(result.status);
  if (result.status === 'ok') expect(result.strategy).not.toBe('wasm');
});

test('P0-T04 follow-up measures 2048-pixel synthetic HEIC decode', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/spikes/p0-t04-followup/probe.html');
  await page.waitForFunction(() => Boolean(window.p0HeicProbe));
  const data = Array.from(readFileSync('spikes/p0-t04-followup/fixtures/synthetic_2048.heic'));
  const result = await page.evaluate(bytes => window.p0HeicProbe!.convert(new Uint8Array(bytes), 'image/heic'), data);
  console.log(`P0-T04 follow-up large ${JSON.stringify({ ...result, thumbnailBytes: result.thumbnailBytes?.length })}`);
  expect(result.status).toBe('ok');
  expect([result.width, result.height]).toEqual([2048, 2048]);
  expect([result.thumbnailWidth, result.thumbnailHeight]).toEqual([8, 8]);
});
