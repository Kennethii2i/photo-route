import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectImage, parseMetadata } from '../../src/infrastructure/image';
import { inspectJpegEnvelope, validateExifTiff } from '../../src/infrastructure/large-jpeg-source';

const original = new Uint8Array(readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg'));
function envelope(width = 16000, height = 3000) {
  const bytes = original.slice();
  for (let at = 2; at + 9 < bytes.length; at += 2 + bytes[at + 2]! * 256 + bytes[at + 3]!) {
    if (bytes[at + 1] === 192) {
      bytes[at + 5] = height >> 8; bytes[at + 6] = height & 255; bytes[at + 7] = width >> 8; bytes[at + 8] = width & 255;
      return { bytes, frame: at };
    }
  }
  throw new Error('Synthetic JPEG frame missing');
}
function plainJpeg() {
  let at = 2;
  while (original[at + 1] !== 225) at += 2 + original[at + 2]! * 256 + original[at + 3]!;
  const end = at + 2 + original[at + 2]! * 256 + original[at + 3]!;
  return new Uint8Array([...original.subarray(0, at), ...original.subarray(end)]);
}
const jpeg = plainJpeg(), shape = inspectImage(jpeg), metadata = await parseMetadata(original);

describe('automatic JPEG source envelope', () => {
  it('keeps strict normal validation and the 60MP raw decode ceiling', () => {
    const { bytes } = envelope();
    expect(() => inspectImage(bytes)).toThrow('安全上限');
    expect(inspectJpegEnvelope(bytes)).toMatchObject({ width: 16000, height: 3000 });
    expect(inspectJpegEnvelope(envelope(16000, 3750).bytes)).toMatchObject({ height: 3750 });
    expect(() => inspectJpegEnvelope(envelope(16000, 4000).bytes)).toThrow('6000万');
  });
  it('rejects zero dimensions, progressive frames, truncation and trailing data', () => {
    const { bytes, frame } = envelope();
    const progressive = bytes.slice(); progressive[frame + 1] = 194;
    for (const bad of [envelope(0, 3000).bytes, progressive, bytes.subarray(0, bytes.length - 2), new Uint8Array([...bytes, 0])]) expect(() => inspectJpegEnvelope(bad)).toThrow();
  });
  it('rejects cyclic and out-of-range Exif references before parsing', () => {
    const empty = new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => validateExifTiff(empty)).not.toThrow();
    const cycle = empty.slice(); new DataView(cycle.buffer).setUint32(10, 8, true);
    const outside = empty.slice(); new DataView(outside.buffer).setUint32(4, 0xfffffff0, true);
    for (const bad of [cycle, outside]) expect(() => validateExifTiff(bad)).toThrow();
  });
  it.each(['jpeg_gps_offset_orientation6.jpg', 'jpeg_local_no_offset.jpg', 'jpeg_invalid_gps.jpg'])('filtered metadata keeps original evidence: %s', async name => {
    const bytes = new Uint8Array(readFileSync(`fixtures/generated/${name}`));
    expect(await parseMetadata(bytes, { sourceFieldsOnly: true })).toEqual(await parseMetadata(bytes));
  });
});

describe('automatic JPEG worker protocol and lifetime', () => {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    static mode = 'success';
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    constructor() { FakeWorker.instances.push(this); }
    postMessage = vi.fn((input: { photoId: string }) => {
      if (FakeWorker.mode === 'post-error') throw new Error('synthetic clone failure');
      if (FakeWorker.mode === 'hang') return;
      const blob = new Blob([jpeg], { type: 'image/jpeg' });
      const value = FakeWorker.mode === 'unsupported' ? { ok: false, code: 'unsupported' } : {
        ok: true, metadata: FakeWorker.mode === 'bad-metadata' ? null : metadata, thumbnail: { id: crypto.randomUUID(), photoId: FakeWorker.mode === 'wrong-id' ? crypto.randomUUID() : input.photoId,
          width: shape.width, height: shape.height, mime: 'image/jpeg', byteLength: blob.size, blob },
      };
      queueMicrotask(() => this.onmessage?.({ data: value } as MessageEvent));
    });
  }
  beforeEach(() => { vi.resetModules(); vi.stubGlobal('Worker', FakeWorker); FakeWorker.instances = []; FakeWorker.mode = 'success'; });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('validates the output and releases its worker', async () => {
    const { makeAutomaticJpeg } = await import('../../src/infrastructure/automatic-jpeg');
    const result = await makeAutomaticJpeg(original.slice(), crypto.randomUUID(), new AbortController().signal);
    expect(result.metadata).toEqual(metadata);
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.instances[0]!.onmessage).toBeNull();
  });
  it('fails unsupported files without poisoning subsequent processing', async () => {
    const { makeAutomaticJpeg, assertImageProcessingReady } = await import('../../src/infrastructure/automatic-jpeg');
    FakeWorker.mode = 'unsupported';
    await expect(makeAutomaticJpeg(original.slice(), crypto.randomUUID(), new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported', stopImport: false });
    expect(assertImageProcessingReady).not.toThrow();
    FakeWorker.mode = 'success'; await makeAutomaticJpeg(original.slice(), crypto.randomUUID(), new AbortController().signal);
  });
  it('terminates on active cancellation and blocks further imports until reload', async () => {
    const { makeAutomaticJpeg, assertImageProcessingReady } = await import('../../src/infrastructure/automatic-jpeg');
    FakeWorker.mode = 'hang'; const controller = new AbortController();
    const pending = expect(makeAutomaticJpeg(original.slice(), crypto.randomUUID(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await pending;
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce(); expect(assertImageProcessingReady).toThrow('再読み込み');
  });
  it('does not block later imports when already cancelled before worker creation', async () => {
    const { makeAutomaticJpeg, assertImageProcessingReady } = await import('../../src/infrastructure/automatic-jpeg');
    const controller = new AbortController(); controller.abort();
    expect(() => makeAutomaticJpeg(original.slice(), crypto.randomUUID(), controller.signal)).toThrow();
    expect(FakeWorker.instances).toHaveLength(0); expect(assertImageProcessingReady).not.toThrow();
  });
  it('stops repeated processing after timeout rather than queueing more native work', async () => {
    const { makeAutomaticJpeg, assertImageProcessingReady } = await import('../../src/infrastructure/automatic-jpeg');
    vi.useFakeTimers(); FakeWorker.mode = 'hang';
    const pending = expect(makeAutomaticJpeg(original.slice(), crypto.randomUUID(), new AbortController().signal)).rejects.toMatchObject({ code: 'timeout', stopImport: true });
    await vi.advanceTimersByTimeAsync(5000); await pending;
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce(); expect(assertImageProcessingReady).toThrow('再読み込み');
    expect(() => makeAutomaticJpeg(original.slice(), crypto.randomUUID(), new AbortController().signal)).toThrow();
    expect(FakeWorker.instances).toHaveLength(1);
  });
  it.each(['onerror', 'onmessageerror'] as const)('stops repeated processing after %s', async event => {
    const { makeAutomaticJpeg, assertImageProcessingReady } = await import('../../src/infrastructure/automatic-jpeg');
    FakeWorker.mode = 'hang';
    const pending = expect(makeAutomaticJpeg(original.slice(), crypto.randomUUID(), new AbortController().signal)).rejects.toMatchObject({ stopImport: true });
    FakeWorker.instances[0]![event]!(); await pending;
    expect(assertImageProcessingReady).toThrow(); expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it.each(['post-error', 'wrong-id', 'bad-metadata'])('rejects malformed worker communication: %s', async mode => {
    const { makeAutomaticJpeg, assertImageProcessingReady } = await import('../../src/infrastructure/automatic-jpeg');
    FakeWorker.mode = mode;
    await expect(makeAutomaticJpeg(original.slice(), crypto.randomUUID(), new AbortController().signal)).rejects.toMatchObject({ code: 'protocol', stopImport: true });
    expect(assertImageProcessingReady).toThrow(); expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
});
