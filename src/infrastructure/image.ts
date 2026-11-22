import ExifReader from 'exifreader';
import type { Photo, Thumbnail } from '../domain/model';
import { interpretSourceGpsTags } from '../domain/gps';
import { sourceClockEvidence } from '../domain/time';

export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_OTHER_SOURCE_BYTES = 20 * 1024 * 1024;
// Reject implausible headers before parsing or decoding. A valid large image can
// still be imported with metadata when it exceeds the separate decode budget.
export const MAX_DECLARED_PIXELS = 100_000_000;
export const MAX_DECLARED_EDGE = 12_000;
export const MAX_THUMBNAIL_PIXELS = 60_000_000;
export const MAX_THUMBNAIL_EDGE = 10_000;
const MAX_OTHER_PIXELS = 12_000_000;
const MAX_OTHER_EDGE = 8192;
const THUMBNAIL_EDGE = 512;
const text = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
const u16be = (bytes: Uint8Array, at: number) => bytes[at]! * 256 + bytes[at + 1]!;
const u32be = (bytes: Uint8Array, at: number) => (bytes[at]! * 0x1000000 + bytes[at + 1]! * 65536 + bytes[at + 2]! * 256 + bytes[at + 3]!);
const u24le = (bytes: Uint8Array, at: number) => bytes[at]! + bytes[at + 1]! * 256 + bytes[at + 2]! * 65536;
const containsAscii = (bytes: Uint8Array, marker: string) => {
  for (let i = 0; i <= bytes.length - marker.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) if (bytes[i + j] !== marker.charCodeAt(j)) { match = false; break; }
    if (match) return true;
  }
  return false;
};

export class ImageDimensionsError extends Error {
  constructor(readonly mime: Photo['sourceMime'], readonly width: number, readonly height: number) {
    super('画像ヘッダーの寸法が安全上限を超えています');
    this.name = 'ImageDimensionsError';
  }
}

export function inspectImage(bytes: Uint8Array): { mime: Photo['sourceMime']; width: number | null; height: number | null } {
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new Error('画像サイズの上限は64 MiBです');
  let mime: Photo['sourceMime'];
  let width: number | null = null;
  let height: number | null = null;
  if (bytes.length >= 24 && text(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') {
    mime = 'image/png';
    if (text(bytes, 12, 16) !== 'IHDR') throw new Error('PNGヘッダーが不正です');
    width = u32be(bytes, 16); height = u32be(bytes, 20);
  } else if (bytes.length >= 12 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP') {
    mime = 'image/webp';
    const chunk = text(bytes, 12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30) { width = 1 + u24le(bytes, 24); height = 1 + u24le(bytes, 27); }
    else if (chunk === 'VP8 ' && bytes.length >= 30 && text(bytes, 23, 26) === '\x9d\x01\x2a') { width = (bytes[26]! + bytes[27]! * 256) & 0x3fff; height = (bytes[28]! + bytes[29]! * 256) & 0x3fff; }
    else if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) { const b1 = bytes[21]!, b2 = bytes[22]!, b3 = bytes[23]!, b4 = bytes[24]!; width = 1 + (((b2 & 0x3f) << 8) | b1); height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)); }
    else throw new Error('WebPヘッダーが不正です');
  } else if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mime = 'image/jpeg';
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      let marker = bytes[i + 1]!; i += 2;
      while (marker === 0xff && i < bytes.length) marker = bytes[i++]!;
      if (marker === 0xda || marker === 0xd9) break;
      if ([0x01, ...Array.from({ length: 8 }, (_, n) => 0xd0 + n)].includes(marker)) continue;
      if (i + 2 > bytes.length) break;
      const size = u16be(bytes, i);
      if (size < 2 || i + size > bytes.length) throw new Error('JPEGセグメントが不正です');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { if (size < 7) throw new Error('JPEG寸法が不正です'); height = u16be(bytes, i + 3); width = u16be(bytes, i + 5); break; }
      i += size;
    }
    if (width === null) throw new Error('JPEG寸法を確認できません');
    let hasEnd = false;
    for (let j = Math.max(0, bytes.length - 65536); j + 1 < bytes.length; j++) {
      if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) { hasEnd = true; break; }
    }
    if (!hasEnd) throw new Error('JPEG終端マーカーを確認できません');
  } else if (bytes.length >= 16 && text(bytes, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(text(bytes, 8, 12))) {
    mime = ['heic', 'heix', 'hevc', 'hevx'].includes(text(bytes, 8, 12)) ? 'image/heic' : 'image/heif';
    let offset = 0; const boxes = new Set<string>();
    while (offset + 8 <= bytes.length) {
      const size = u32be(bytes, offset), box = text(bytes, offset + 4, offset + 8);
      if (size < 8 || offset + size > bytes.length) throw new Error('HEIFボックスが不正です');
      boxes.add(box); offset += size;
    }
    if (offset !== bytes.length || !boxes.has('meta') || !boxes.has('mdat') || !containsAscii(bytes, 'hvc1') || !containsAscii(bytes, 'hvcC')) throw new Error('HEIFコンテナまたはHEVC画像構造を確認できません');
    // HEIF container dimensions are not trusted as a coded-pixel bound; no software decode is used.
  } else throw new Error('対応していない画像形式または署名です');
  if (mime !== 'image/jpeg' && bytes.length > MAX_OTHER_SOURCE_BYTES) throw new Error('この画像形式のサイズ上限は20 MiBです');
  const edgeLimit = mime === 'image/jpeg' ? MAX_DECLARED_EDGE : MAX_OTHER_EDGE;
  const pixelLimit = mime === 'image/jpeg' ? MAX_DECLARED_PIXELS : MAX_OTHER_PIXELS;
  if (width !== null && height !== null && (!width || !height || width > edgeLimit || height > edgeLimit || width * height > pixelLimit)) throw new ImageDimensionsError(mime, width, height);
  return { mime, width, height };
}

const tag = (group: Record<string, { value?: unknown }> | undefined, name: string): unknown => group?.[name]?.value ?? null;
const scalar = (value: unknown): string | null => typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 && typeof value[0] === 'string' ? value[0] : null;

export async function parseMetadata(bytes: Uint8Array, options: { sourceFieldsOnly?: boolean } = {}): Promise<Pick<Photo, 'sourceGps' | 'sourceTime' | 'sourceOrientation' | 'metadataIssues'>> {
  const metadataIssues: string[] = [];
  let group: Record<string, { value?: unknown }> | undefined;
  try { group = (await ExifReader.load(bytes, {
    expanded: true,
    ...(options.sourceFieldsOnly ? { computed: false, includeTags: { exif: ['DateTimeOriginal', 'OffsetTimeOriginal', 'GPSDateStamp', 'GPSTimeStamp', 'GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude', 'GPSMapDatum', 'GPSHPositioningError', 'Orientation'] } } : {}),
  })).exif as typeof group; }
  catch (error) { metadataIssues.push(`Exif解析失敗: ${error instanceof Error ? error.message : String(error)}`); }
  const raw = (name: string) => tag(group, name);
  const rawDateTimeOriginal = scalar(raw('DateTimeOriginal'));
  const rawOffsetTimeOriginal = scalar(raw('OffsetTimeOriginal'));
  const rawGpsDateStamp = scalar(raw('GPSDateStamp'));
  const rawGpsTimeStamp = raw('GPSTimeStamp');
  const clock = sourceClockEvidence(rawDateTimeOriginal, rawOffsetTimeOriginal);
  const names = ['GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude', 'GPSMapDatum', 'GPSHPositioningError'];
  const rawTags = Object.fromEntries(names.map(name => [name, raw(name)])) as Record<string, unknown>;
  const gps = interpretSourceGpsTags(rawTags);
  const sourceOrientation = typeof raw('Orientation') === 'number' && Number.isInteger(raw('Orientation')) && Number(raw('Orientation')) >= 1 && Number(raw('Orientation')) <= 8 ? Number(raw('Orientation')) : null;
  return {
    sourceGps: { rawTags: JSON.parse(JSON.stringify(rawTags)), normalized: gps.normalized, horizontalErrorMeters: gps.horizontalErrorMeters, datum: gps.datum, status: gps.status, issues: gps.issues },
    sourceTime: { rawDateTimeOriginal, rawOffsetTimeOriginal, rawGpsDateStamp, rawGpsTimeStamp: JSON.parse(JSON.stringify(rawGpsTimeStamp)), ...clock, issues: clock.status === 'invalid' ? ['撮影日時の形式または値が不正です'] : [] },
    sourceOrientation, metadataIssues,
  };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export async function makeThumbnail(bytes: Uint8Array, mime: Photo['sourceMime'], photoId: string, rawOrientation: number | null): Promise<Thumbnail> {
  if (mime === 'image/heic' || mime === 'image/heif') throw new Error('HEIC/HEIFの安全なサムネイル復号は未対応です');
  const source = inspectImage(bytes);
  if (source.mime !== mime || source.width === null || source.height === null) throw new Error('画像寸法を確認できません');
  const edgeLimit = mime === 'image/jpeg' ? MAX_THUMBNAIL_EDGE : MAX_OTHER_EDGE;
  const pixelLimit = mime === 'image/jpeg' ? MAX_THUMBNAIL_PIXELS : MAX_OTHER_PIXELS;
  if (source.width > edgeLimit || source.height > edgeLimit || source.width * source.height > pixelLimit) throw new Error('サムネイル復号の安全上限を超えています');
  const orientation = mime === 'image/webp' && rawOrientation && rawOrientation >= 1 && rawOrientation <= 8 ? rawOrientation : 1;
  const swapsAxes = orientation >= 5 && orientation <= 8;
  const browserSwapsAxes = mime !== 'image/webp' && rawOrientation !== null && rawOrientation >= 5 && rawOrientation <= 8;
  const orientedWidth = (swapsAxes || browserSwapsAxes) ? source.height : source.width;
  const orientedHeight = (swapsAxes || browserSwapsAxes) ? source.width : source.height;
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(orientedWidth, orientedHeight));
  const requestedWidth = Math.max(1, Math.round((mime === 'image/webp' ? source.width : orientedWidth) * scale));
  const requestedHeight = Math.max(1, Math.round((mime === 'image/webp' ? source.height : orientedHeight) * scale));
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }), {
      imageOrientation: mime === 'image/webp' ? 'none' : 'from-image',
      ...(scale < 1 ? { resizeWidth: requestedWidth, resizeHeight: requestedHeight, resizeQuality: 'high' as const } : {}),
    });
    if (bitmap.width > THUMBNAIL_EDGE || bitmap.height > THUMBNAIL_EDGE) throw new Error('縮小復号後の寸法が上限を超えています');
    // Current Chrome applies JPEG/PNG EXIF during decode but not WebP EXIF.
    // Use its decoded orientation for JPEG/PNG; explicitly transform only WebP.
    const width = swapsAxes ? bitmap.height : bitmap.width;
    const height = swapsAxes ? bitmap.width : bitmap.height;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvasを利用できません');
    const s = 1, w = bitmap.width, h = bitmap.height;
    const transform: Record<number, [number, number, number, number, number, number]> = {
      1: [s, 0, 0, s, 0, 0], 2: [-s, 0, 0, s, w * s, 0], 3: [-s, 0, 0, -s, w * s, h * s], 4: [s, 0, 0, -s, 0, h * s],
      5: [0, s, s, 0, 0, 0], 6: [0, s, -s, 0, h * s, 0], 7: [0, -s, -s, 0, h * s, w * s], 8: [0, -s, s, 0, 0, w * s],
    };
    context.setTransform(...transform[orientation]!);
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(x => x ? resolve(x) : reject(new Error('サムネイルの符号化に失敗しました')), 'image/jpeg', 0.82));
    if (blob.size > 1024 * 1024) throw new Error('サムネイルが上限を超えています');
    return { id: crypto.randomUUID(), photoId, mime: 'image/jpeg', width, height, byteLength: blob.size, blob };
  } finally { bitmap?.close(); }
}
