import { MAX_THUMBNAIL_PIXELS, MAX_SOURCE_BYTES, parseMetadata } from './image';

// Separate from inspectImage/ZIP validation. Bounds work before the native
// decoder and accepts only single-scan, 8-bit, three-component baseline JPEG.
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_SEGMENTS = 256;
const EMPTY_TIFF = new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const u16be = (bytes: Uint8Array, at: number) => bytes[at]! * 256 + bytes[at + 1]!;
export class LargeJpegSourceError extends Error {
  constructor(readonly code: 'unsupported' | 'size' | 'invalid', detail: string) { super(detail); }
}
const failure = (reason: string, code: 'unsupported' | 'size' | 'invalid' = 'invalid'): never => { throw new LargeJpegSourceError(code, reason); };

export function validateExifTiff(bytes: Uint8Array): void {
  if (bytes.length < 14 || bytes.length > 65527) failure('Exifの容量が範囲外です');
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77)) failure('Exifの形式が不正です');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) failure('Exifの形式が未対応です');
  const widths = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  const pending = [u32(4)], seen = new Set<number>();
  let entries = 0, values = 0;
  while (pending.length) {
    const at = pending.pop()!;
    if (at === 0) continue;
    if (seen.has(at) || seen.size >= 8 || at < 8 || at + 2 > bytes.length) failure('Exifの参照が不正です');
    seen.add(at);
    const count = u16(at); entries += count;
    if (entries > 256 || at + 2 + count * 12 + 4 > bytes.length) failure('Exifの項目数または参照が範囲外です');
    for (let index = 0; index < count; index++) {
      const entry = at + 2 + index * 12, tag = u16(entry), type = u16(entry + 2), count = u32(entry + 4);
      const width = widths[type];
      if (!width || !count) failure('Exifの項目型または個数が不正です');
      const length = width! * count; values += length;
      const start = length <= 4 ? entry + 8 : u32(entry + 8);
      if (values > 65536 || start < 8 || start + length > bytes.length) failure('Exifの値の参照が範囲外です');
      if (type === 2 && bytes[start + length - 1] !== 0) failure('Exif文字列の終端が不正です');
      if ([0x8769, 0x8825, 0xa005].includes(tag)) {
        if (type !== 4 || count !== 1) failure('Exifの子参照が不正です');
        pending.push(u32(entry + 8));
      }
    }
    pending.push(u32(at + 2 + count * 12));
  }
}

export function inspectJpegEnvelope(bytes: Uint8Array): { width: number; height: number; exif: Uint8Array } {
  if (bytes.length < 4 || bytes.length > MAX_SOURCE_BYTES) failure('原本の容量上限は64MiBです', 'size');
  if (bytes[0] !== 255 || bytes[1] !== 216) failure('JPEG原本だけに対応しています');
  let at = 2, segments = 0, width = 0, height = 0, components = 0, exif: Uint8Array | null = null;
  while (at < bytes.length) {
    if (++segments > MAX_SEGMENTS || at > MAX_HEADER_BYTES) failure('ヘッダーの処理上限を超えています');
    if (bytes[at++] !== 255) failure('JPEGマーカーが不正です');
    while (bytes[at] === 255) { if (++at > MAX_HEADER_BYTES) failure('ヘッダーの処理上限を超えています'); }
    if (at >= bytes.length) failure('JPEGが途中で切れています');
    const marker = bytes[at++]!;
    if ([0, 1, 216, 217].includes(marker) || (marker >= 208 && marker <= 215)) failure('JPEGマーカーの順序が不正です');
    if (![192, 196, 218, 219, 221, 254].includes(marker) && !(marker >= 224 && marker <= 239)) failure('対応外のJPEGマーカーです', 'unsupported');
    if (at + 2 > bytes.length) failure('JPEG長さがありません');
    const size = u16be(bytes, at), end = at + size;
    if (size < 2 || end > bytes.length || end > MAX_HEADER_BYTES) failure('JPEG区画の長さが範囲外です');
    if (marker === 225 && size >= 8 && bytes.subarray(at + 2, at + 8).every((value, index) => value === [69, 120, 105, 102, 0, 0][index])) {
      if (exif) failure('複数のExif区画には対応していません', 'unsupported');
      exif = bytes.slice(at + 8, end); validateExifTiff(exif);
    }
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (marker !== 192 || components) failure('単一フレームのbaseline JPEGだけに対応しています', 'unsupported');
      if (size < 11 || bytes[at + 2] !== 8) failure('JPEGフレームが不正です');
      height = u16be(bytes, at + 3); width = u16be(bytes, at + 5); components = bytes[at + 7]!;
      if (!width || !height || size !== 8 + 3 * components) failure('JPEG寸法またはフレームが不正です');
      if (width * height > MAX_THUMBNAIL_PIXELS) failure('復号する原本は6000万画素以内にしてください', 'size');
      if (components !== 3) failure('3成分のbaseline JPEGだけに対応しています', 'unsupported');
    }
    if (marker === 218) {
      if (!components || bytes[at + 2] !== components || size !== 6 + 2 * components || bytes[end - 3] !== 0 || bytes[end - 2] !== 63 || bytes[end - 1] !== 0) failure('単一スキャンのbaseline JPEGだけに対応しています', 'unsupported');
      let data = end;
      while (data < bytes.length) {
        if (bytes[data++] !== 255) continue;
        while (bytes[data] === 255) data++;
        const code = bytes[data++];
        if (code === 0 || (code !== undefined && code >= 208 && code <= 215)) continue;
        if (code === 217 && data === bytes.length && data > end + 2) return { width, height, exif: exif ?? EMPTY_TIFF.slice() };
        failure('JPEG画像区画が途中で切れたか、対応外の構造です');
      }
      failure('JPEG終端がありません');
    }
    at = end;
  }
  return failure('JPEG画像区画がありません');
}

export async function readLargeJpegSource(bytes: Uint8Array) {
  const envelope = inspectJpegEnvelope(bytes);
  const metadata = await parseMetadata(envelope.exif, { sourceFieldsOnly: true });
  if (metadata.metadataIssues.some(issue => issue.startsWith('Exif解析失敗:'))) failure('Exifを安全に読み取れません');
  return { width: envelope.width, height: envelope.height, metadata };
}

export type LargeJpegSource = Awaited<ReturnType<typeof readLargeJpegSource>>;
