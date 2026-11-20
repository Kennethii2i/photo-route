// A provisional disk-stream ceiling. The largest measured 5,000-thumbnail case is ~127 MB.
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_BUFFERED_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
// v2 adds one link record to the four v1 record entries, manifest and 5,000 thumbnails.
export const MAX_ENTRIES = 5006;
export const MAX_RECORD_ENTRY_BYTES = 32 * 1024 * 1024;
export const MAX_THUMB_ENTRY_BYTES = 1024 * 1024;
const MAX_DIRECTORY_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

const abortIfRequested = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('処理を中断しました', 'AbortError');
};
export const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (view: DataView, at: number) => view.getUint16(at, true);
const u32 = (view: DataView, at: number) => view.getUint32(at, true);
const set16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
const set32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);
const allowed = (path: string) => path === 'manifest.json' || ['records/trips.json', 'records/visits.json', 'records/photos.json', 'records/thumbnails.json', 'records/photo-album-links.json'].includes(path)
  || /^media\/thumbnails\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path);
const entryLimit = (path: string) => path.startsWith('media/') ? MAX_THUMB_ENTRY_BYTES : MAX_RECORD_ENTRY_BYTES;
const validPath = (path: string) => allowed(path) && !path.includes('..') && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/');

type CentralEntry = { path: string; size: number; compressed: number; crc: number; method: number; localOffset: number; dataStart: number; dataEnd: number };

/** ZIP32 stored entries. Each write finishes before the next entry is read. */
export class ZipStreamWriter {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly directory: Uint8Array[] = [];
  private position = 0;
  private closed = false;
  private readonly paths = new Set<string>();

  constructor(stream: WritableStream<Uint8Array>, private readonly maxBytes: number = MAX_ARCHIVE_BYTES, private readonly signal?: AbortSignal) {
    this.writer = stream.getWriter();
  }

  private async write(bytes: Uint8Array): Promise<void> {
    abortIfRequested(this.signal);
    if (this.position + bytes.length > this.maxBytes || this.position + bytes.length > 0xffffffff) throw new Error('ZIP書き出しサイズの暫定上限を超えています');
    await this.writer.write(bytes);
    this.position += bytes.length;
    abortIfRequested(this.signal);
  }

  async add(path: string, bytes: Uint8Array): Promise<void> {
    abortIfRequested(this.signal);
    const name = encoder.encode(path);
    if (!validPath(path) || this.paths.has(path) || name.length > 255 || bytes.length > entryLimit(path) || this.directory.length >= MAX_ENTRIES) throw new Error('ZIPエントリの名前・件数・サイズが不正です');
    const checksum = crc32(bytes), offset = this.position;
    const local = new Uint8Array(30 + name.length), localView = viewOf(local);
    set32(localView, 0, 0x04034b50); set16(localView, 4, 20); set32(localView, 14, checksum);
    set32(localView, 18, bytes.length); set32(localView, 22, bytes.length); set16(localView, 26, name.length);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length), centralView = viewOf(central);
    set32(centralView, 0, 0x02014b50); set16(centralView, 4, 20); set16(centralView, 6, 20);
    set32(centralView, 16, checksum); set32(centralView, 20, bytes.length); set32(centralView, 24, bytes.length);
    set16(centralView, 28, name.length); set32(centralView, 42, offset); central.set(name, 46);
    await this.write(local); await this.write(bytes);
    this.directory.push(central); this.paths.add(path);
  }

  async close(): Promise<number> {
    if (this.closed) throw new Error('ZIPは既に終了しました');
    if (this.directory.length < 5 || this.directory.length > MAX_ENTRIES) throw new Error('ZIPの必須エントリまたは件数が不正です');
    const directoryStart = this.position;
    for (const entry of this.directory) await this.write(entry);
    const directorySize = this.position - directoryStart;
    if (directorySize > MAX_DIRECTORY_BYTES) throw new Error('ZIP中央ディレクトリが大きすぎます');
    const end = new Uint8Array(22), view = viewOf(end);
    set32(view, 0, 0x06054b50); set16(view, 8, this.directory.length); set16(view, 10, this.directory.length);
    set32(view, 12, directorySize); set32(view, 16, directoryStart);
    await this.write(end);
    await this.writer.close(); this.writer.releaseLock(); this.closed = true;
    return this.position;
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { await this.writer.abort().catch(() => undefined); }
    finally { this.writer.releaseLock(); }
  }
}

async function readRange(blob: Blob, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
  abortIfRequested(signal);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > blob.size) throw new Error('ZIPの範囲が不正です');
  const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  abortIfRequested(signal);
  return bytes;
}

async function inflateBounded(packed: Uint8Array, expected: number, signal?: AbortSignal): Promise<Uint8Array> {
  let decoderStream: DecompressionStream;
  try { decoderStream = new DecompressionStream('deflate-raw'); }
  catch { throw new Error('圧縮ZIPをこのブラウザで安全に展開できません'); }
  const source = new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(new Uint8Array(packed)); controller.close(); } });
  const reader = source.pipeThrough(decoderStream).getReader();
  const output = new Uint8Array(expected);
  let used = 0;
  try {
    while (true) {
      abortIfRequested(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (used + value.length > expected) throw new Error('ZIP展開サイズが宣言値を超えています');
      output.set(value, used); used += value.length;
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (used !== expected) throw new Error('ZIP展開サイズが宣言値と一致しません');
  return output;
}

export async function openZip(blob: Blob, signal?: AbortSignal): Promise<{ entries: Map<string, CentralEntry>; read: (path: string) => Promise<Uint8Array> }> {
  if (blob.size < 22 || blob.size > MAX_ARCHIVE_BYTES) throw new Error('ZIPのサイズが不正または暫定上限を超えています');
  const tailStart = Math.max(0, blob.size - 65557), tail = await readRange(blob, tailStart, blob.size - tailStart, signal);
  const tailView = viewOf(tail);
  let endAt = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (u32(tailView, at) === 0x06054b50 && at + 22 + u16(tailView, at + 20) === tail.length) { endAt = at; break; }
  }
  if (endAt < 0) throw new Error('ZIP中央ディレクトリがありません');
  const count = u16(tailView, endAt + 10), directorySize = u32(tailView, endAt + 12), directoryStart = u32(tailView, endAt + 16);
  if (u16(tailView, endAt + 4) !== 0 || u16(tailView, endAt + 6) !== 0 || u16(tailView, endAt + 8) !== count ||
    count < 5 || count > MAX_ENTRIES || directorySize > MAX_DIRECTORY_BYTES || directoryStart + directorySize !== tailStart + endAt) throw new Error('ZIPの件数・分割・ディレクトリが不正です');
  const directory = await readRange(blob, directoryStart, directorySize, signal), view = viewOf(directory);
  const entries = new Map<string, CentralEntry>();
  let cursor = 0, expandedTotal = 0;
  for (let index = 0; index < count; index++) {
    abortIfRequested(signal);
    if (cursor + 46 > directory.length || u32(view, cursor) !== 0x02014b50) throw new Error('ZIPエントリが不正です');
    const flags = u16(view, cursor + 8), method = u16(view, cursor + 10), crc = u32(view, cursor + 16);
    const compressed = u32(view, cursor + 20), size = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28), extraLength = u16(view, cursor + 30), commentLength = u16(view, cursor + 32);
    const offset = u32(view, cursor + 42), next = cursor + 46 + nameLength + extraLength + commentLength;
    if (nameLength < 1 || nameLength > 255 || extraLength > 4096 || next > directory.length || flags !== 0 || ![0, 8].includes(method) ||
      u16(view, cursor + 34) !== 0 || offset >= directoryStart) throw new Error('ZIPに危険または過大なエントリがあります');
    const path = decoder.decode(directory.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!validPath(path) || entries.has(path) || size > entryLimit(path) || compressed > entryLimit(path) ||
      (method === 0 && compressed !== size) || (compressed === 0 && size > 0) || (compressed > 0 && size / compressed > 100)) throw new Error('ZIPに危険または過大なエントリがあります');
    expandedTotal += size;
    if (expandedTotal > MAX_EXPANDED_BYTES) throw new Error('ZIP展開後サイズの暫定上限を超えています');
    entries.set(path, { path, size, compressed, crc, method, localOffset: offset, dataStart: 0, dataEnd: 0 });
    cursor = next;
  }
  if (cursor !== directory.length || !['manifest.json', 'records/trips.json', 'records/visits.json', 'records/photos.json', 'records/thumbnails.json'].every(path => entries.has(path))) throw new Error('ZIP必須エントリがありません');
  for (const entry of entries.values()) {
    const header = await readRange(blob, entry.localOffset, 30, signal), local = viewOf(header);
    const nameLength = u16(local, 26), extraLength = u16(local, 28);
    if (u32(local, 0) !== 0x04034b50 || u16(local, 6) !== 0 || u16(local, 8) !== entry.method || u32(local, 14) !== entry.crc ||
      u32(local, 18) !== entry.compressed || u32(local, 22) !== entry.size || nameLength > 255 || extraLength > 4096) throw new Error('ZIPローカルヘッダーが不正です');
    const name = await readRange(blob, entry.localOffset + 30, nameLength, signal);
    entry.dataStart = entry.localOffset + 30 + nameLength + extraLength; entry.dataEnd = entry.dataStart + entry.compressed;
    if (decoder.decode(name) !== entry.path || entry.dataEnd > directoryStart) throw new Error('ZIPヘッダーと内容の範囲が不正です');
  }
  const ordered = [...entries.values()].sort((a, b) => a.localOffset - b.localOffset);
  if (ordered[0]!.localOffset !== 0 || ordered[ordered.length - 1]!.dataEnd !== directoryStart || ordered.some((entry, index) => index > 0 && ordered[index - 1]!.dataEnd !== entry.localOffset)) throw new Error('ZIPエントリの範囲が重複または欠落しています');
  return { entries, read: async path => {
    const entry = entries.get(path);
    if (!entry) throw new Error('ZIPエントリがありません');
    const packed = await readRange(blob, entry.dataStart, entry.compressed, signal);
    const bytes = entry.method === 0 ? packed : await inflateBounded(packed, entry.size, signal);
    abortIfRequested(signal);
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error(`ZIPエントリのサイズまたはCRCが不正です: ${path}`);
    return bytes;
  } };
}
