import { photoSchema, type Photo } from '../domain/model';
import { inspectImage, makeThumbnail, MAX_SOURCE_BYTES, parseMetadata, sha256 } from '../infrastructure/image';
import { LibraryDb, type ImportJob } from '../infrastructure/storage';

export type FileOutcome = { filename: string; state: 'imported' | 'partial' | 'skipped-duplicate' | 'failed' | 'cancelled'; reason: string | null; photoId: string | null };
export type ImportProgress = { job: ImportJob; outcomes: FileOutcome[] };

export class PhotoImporter {
  private cancelled = false;
  constructor(private readonly db: LibraryDb) {}
  cancel(): void { this.cancelled = true; }
  async importFiles(files: File[], tripId: string | null, onProgress?: (progress: ImportProgress) => void, options: { allowDuplicateAcrossTrips?: boolean } = {}): Promise<ImportProgress> {
    this.cancelled = false;
    if (!tripId) throw new Error('写真を取り込む前に、追加先の旅行を選択してください');
    const trip = tripId ? await this.db.getTrip(tripId) : null;
    if (tripId && (!trip || trip.deletedAt)) throw new Error('指定されたTripがありません');
    const job: ImportJob = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), targetTripId: tripId, total: files.length, processed: 0, state: 'running', lastError: null };
    const outcomes: FileOutcome[] = [];
    await this.db.saveJob(job);
    const publish = async () => { await this.db.saveJob(job); onProgress?.({ job: { ...job }, outcomes: [...outcomes] }); };
    await publish();
    const processFile = async (file: File, filename: string): Promise<FileOutcome> => {
      if (this.cancelled) return { filename, state: 'cancelled', reason: '利用者が中断しました', photoId: null };
      try {
        return await readFile(file, filename);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        job.lastError = reason;
        return { filename, state: 'failed', reason, photoId: null };
      }
    };
    const readFile = async (file: File, filename: string): Promise<FileOutcome> => {
      if (file.size < 1 || file.size > MAX_SOURCE_BYTES) throw new Error('画像サイズの暫定上限は64 MiBです');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = inspectImage(bytes);
      const hash = await sha256(bytes);
      const duplicates = await this.db.findByHash(hash);
      const duplicateException = duplicates.length > 0 && options.allowDuplicateAcrossTrips === true && tripId !== null && duplicates.every(photo => photo.tripId !== tripId);
      if (duplicates.length && !duplicateException) return { filename, state: 'skipped-duplicate', reason: '元画像のSHA-256が既存写真と一致します。同じ旅行への重複登録はできません', photoId: null };
      if (this.cancelled) return { filename, state: 'cancelled', reason: '利用者が中断しました', photoId: null };
      const metadata = await parseMetadata(bytes);
      const id = crypto.randomUUID();
      let thumbnail = null;
      let thumbnailError: string | null = null;
      try { thumbnail = await makeThumbnail(bytes, format.mime, id, metadata.sourceOrientation); }
      catch (error) { thumbnailError = error instanceof Error ? error.message : String(error); }
      const now = new Date().toISOString();
      const photo: Photo = photoSchema.parse({
        id, tripId, visitId: null, originalFilename: filename, sourceMime: format.mime, sourceByteLength: bytes.length,
        contentSha256: hash, ...metadata, gpsCorrection: null, timeCorrection: null,
        thumbnailId: thumbnail?.id ?? null, thumbnailState: thumbnail ? 'available' : 'failed',
        metadataIssues: thumbnailError ? [...metadata.metadataIssues, `サムネイル未生成: ${thumbnailError}`] : metadata.metadataIssues,
        importedAt: now, updatedAt: now, deletedAt: null,
      });
      await this.db.savePhoto(photo, thumbnail, { allowDuplicateAcrossTrips: duplicateException });
      return { filename, state: thumbnail ? 'imported' : 'partial', reason: [duplicateException ? '明示的に別の旅行へ重複写真として追加しました' : null, thumbnailError].filter(Boolean).join(' / ') || null, photoId: id };
    };
    for (const file of files) {
      const filename = Array.from(file.name.split(/[\\/]/).pop() || '名称不明').filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 255) || '名称不明';
      outcomes.push(await processFile(file, filename));
      job.processed++;
      await publish();
    }
    job.state = this.cancelled ? 'cancelled' : 'completed';
    await publish();
    return { job: { ...job }, outcomes };
  }
}
