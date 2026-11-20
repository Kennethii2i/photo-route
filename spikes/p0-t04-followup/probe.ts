import { heicTo } from 'heic-to/csp';

type ProbeResult = {
  status: 'ok' | 'failed';
  reason?: string;
  declaredWidth?: number;
  declaredHeight?: number;
  width?: number;
  height?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  thumbnailBytes?: number[];
  topLeft?: number[];
  topRight?: number[];
  elapsedMs: number;
  heapBefore: number | null;
  heapAfter: number | null;
};

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 8192;
const MAX_PIXELS = 40_000_000;
const memory = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;

export async function preflight(blob: Blob): Promise<{ width: number; height: number }> {
  if (blob.size < 32 || blob.size > MAX_BYTES) throw new Error('source byte limit');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ascii = (at: number, count: number) => String.fromCharCode(...bytes.subarray(at, at + count));
  if (ascii(4, 4) !== 'ftyp' || !['heic', 'heix', 'hevc', 'hevx'].includes(ascii(8, 4))) throw new Error('unsupported HEIC signature');
  let ispe = -1;
  for (let i = 4; i < bytes.length - 16; i++) {
    if (ascii(i, 4) === 'ispe') { ispe = i; break; }
  }
  if (ispe < 0) throw new Error('image dimensions missing');
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(ispe + 8);
  const height = view.getUint32(ispe + 12);
  if (!width || !height || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) throw new Error('declared pixel limit');
  return { width, height };
}

export async function convert(bytes: Uint8Array, mime: string): Promise<ProbeResult> {
  const started = performance.now();
  const heapBefore = memory();
  let bitmap: ImageBitmap | null = null;
  try {
    const blob = new Blob([new Uint8Array(bytes)], { type: mime });
    const declared = await preflight(blob);
    bitmap = await heicTo({ blob, type: 'bitmap' });
    if (bitmap.width > MAX_EDGE || bitmap.height > MAX_EDGE || bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('decoded pixel limit');
    const ratio = Math.min(1, 8 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas context');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const topLeft = Array.from(context.getImageData(1, 1, 1, 1).data);
    const topRight = Array.from(context.getImageData(canvas.width - 2, 1, 1, 1).data);
    const thumbnail = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('thumbnail encode failure')), 'image/jpeg', 0.8));
    return {
      status: 'ok', declaredWidth: declared.width, declaredHeight: declared.height,
      width: bitmap.width, height: bitmap.height, thumbnailWidth: canvas.width,
      thumbnailHeight: canvas.height, thumbnailBytes: Array.from(new Uint8Array(await thumbnail.arrayBuffer())),
      topLeft, topRight, elapsedMs: performance.now() - started, heapBefore, heapAfter: memory(),
    };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error), elapsedMs: performance.now() - started, heapBefore, heapAfter: memory() };
  } finally {
    bitmap?.close();
  }
}

declare global {
  interface Window { p0HeicProbe?: { convert: typeof convert; preflight: typeof preflight } }
}
window.p0HeicProbe = { convert, preflight };
