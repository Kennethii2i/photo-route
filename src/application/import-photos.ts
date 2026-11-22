import { photoSchema, type Photo, type Thumbnail } from '../domain/model';
import { ImageDimensionsError, inspectImage, makeThumbnail, MAX_DECLARED_EDGE, MAX_SOURCE_BYTES, MAX_THUMBNAIL_EDGE, MAX_THUMBNAIL_PIXELS, parseMetadata, sha256 } from '../infrastructure/image';
import { assertImageProcessingReady, AutomaticJpegError, makeAutomaticJpeg } from '../infrastructure/automatic-jpeg';
import { LibraryDb, type ImportJob } from '../infrastructure/storage';

export type FileOutcome = { filename: string; state: 'imported' | 'partial' | 'skipped-duplicate' | 'failed' | 'cancelled'; reason: string | null; photoId: string | null };
export type ImportProgress = { job: ImportJob; outcomes: FileOutcome[] };

type PreparedPhoto = { filename: string; hash: string; photo: Photo | null; thumbnail: Thumbnail | null; thumbnailError: string | null; error: string | null };
type PreparedFile = FileOutcome | PreparedPhoto;
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

// These budgets limit live input buffers and declared decode work, not total
// browser memory. Decoder internals, temporary copies and GC remain browser-owned.
class PreparationBudget {
  private used = 0;
  private readonly waiting: { amount: number; start: () => void }[] = [];
  constructor(private readonly limit: number) {}
  async run<T>(amount: number, action: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => { this.waiting.push({ amount, start: resolve }); this.drain(); });
    try { return await action(); }
    finally { this.used -= amount; this.drain(); }
  }
  private drain(): void {
    while (this.waiting.length && this.used + this.waiting[0]!.amount <= this.limit) {
      const next = this.waiting.shift()!; this.used += next.amount; next.start();
    }
  }
}

export class PhotoImporter {
  private cancelled = false;
  private abort: AbortController | null = null;
  constructor(private readonly db: LibraryDb, private readonly preparationConcurrency: 1 | 2 = 2) {}
  cancel(): void { this.cancelled = true; this.abort?.abort(); }
  async importFiles(files: File[], tripId: string | null, onProgress?: (progress: ImportProgress) => void, options: { allowDuplicateAcrossTrips?: boolean } = {}): Promise<ImportProgress> {
    this.cancelled = false;
    assertImageProcessingReady();
    if (!tripId) throw new Error('写真を取り込む前に、追加先の旅行を選択してください');
    const trip = tripId ? await this.db.getTrip(tripId) : null;
    if (tripId && (!trip || trip.deletedAt)) throw new Error('指定されたTripがありません');
    const job: ImportJob = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), targetTripId: tripId, total: files.length, processed: 0, state: 'running', lastError: null };
    const outcomes: FileOutcome[] = [];
    await this.db.saveJob(job);
    const publish = async () => { await this.db.saveJob(job); onProgress?.({ job: { ...job }, outcomes: [...outcomes] }); };
    await publish();
    const sourceBudget = new PreparationBudget(MAX_SOURCE_BYTES);
    const decodeBudget = new PreparationBudget(MAX_THUMBNAIL_PIXELS);
    const abort = new AbortController(); this.abort = abort;
    const fatal: { error: AutomaticJpegError | null } = { error: null };
    let stopped = false;
    const cancelled = (filename: string): FileOutcome => ({ filename, state: 'cancelled', reason: '利用者が中断しました', photoId: null });
    const duplicate = (filename: string): FileOutcome => ({ filename, state: 'skipped-duplicate', reason: '元画像のSHA-256が既存写真と一致します。同じ旅行への重複登録はできません', photoId: null });
    const duplicateStatus = async (hash: string) => {
      const duplicates = await this.db.findByHash(hash);
      const exception = duplicates.length > 0 && options.allowDuplicateAcrossTrips === true && duplicates.every(photo => photo.tripId !== tripId);
      return { skip: duplicates.length > 0 && !exception, exception };
    };
    const readFile = async (file: File, filename: string): Promise<PreparedFile> => {
      if (file.size < 1 || file.size > MAX_SOURCE_BYTES) throw new Error('画像サイズの暫定上限は64 MiBです');
      return sourceBudget.run(file.size, async () => {
        if (this.cancelled || stopped || abort.signal.aborted) return cancelled(filename);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sourceLength = bytes.length;
        let format: ReturnType<typeof inspectImage>, automatic = false;
        try { format = inspectImage(bytes); }
        catch (error) {
          if (!(error instanceof ImageDimensionsError)) throw error;
          if (error.mime !== 'image/jpeg' || error.width < 1 || error.height < 1 || error.width * error.height > MAX_THUMBNAIL_PIXELS || Math.max(error.width, error.height) <= MAX_DECLARED_EDGE) {
            throw new Error(`この写真は、安全に処理できる大きさを超えています（${error.width}×${error.height}px）。`, { cause: error });
          }
          format = { mime: error.mime, width: error.width, height: error.height }; automatic = true;
        }
        const hash = await sha256(bytes);
        if ((await duplicateStatus(hash)).skip) return duplicate(filename);
        if (this.cancelled || stopped || abort.signal.aborted) return cancelled(filename);
        try {
          const id = crypto.randomUUID();
          let metadata: Awaited<ReturnType<typeof parseMetadata>>;
          let thumbnail: Thumbnail | null = null;
          let thumbnailError: string | null = null;
          // Ineligible images still take the existing partial-success path;
          // never enqueue a decode request that exceeds the scheduling budget.
          const pixels = format.width !== null && format.height !== null && format.width <= MAX_THUMBNAIL_EDGE && format.height <= MAX_THUMBNAIL_EDGE && format.width * format.height <= MAX_THUMBNAIL_PIXELS
            ? format.width * format.height : 0;
          if (automatic) {
            // Reserve the whole existing decode budget: large-image processing
            // is exclusive with both normal and other automatic decodes.
            const result = await decodeBudget.run(MAX_THUMBNAIL_PIXELS, async () => {
              if (this.cancelled || stopped || abort.signal.aborted) return null;
              return makeAutomaticJpeg(bytes, id, abort.signal);
            });
            if (!result) return cancelled(filename);
            metadata = result.metadata; thumbnail = result.thumbnail;
          } else {
            metadata = await parseMetadata(bytes);
            try {
              thumbnail = await decodeBudget.run(pixels, async () => {
                if (this.cancelled || stopped || abort.signal.aborted) return null;
                assertImageProcessingReady();
                return makeThumbnail(bytes, format.mime, id, metadata.sourceOrientation);
              });
              if (!thumbnail) return cancelled(filename);
            } catch (error) { if (error instanceof AutomaticJpegError && error.stopImport) throw error; thumbnailError = errorText(error); }
          }
          const now = new Date().toISOString();
          const photo = photoSchema.parse({
            id, tripId, visitId: null, originalFilename: filename, sourceMime: format.mime, sourceByteLength: sourceLength,
            contentSha256: hash, ...metadata, gpsCorrection: null, timeCorrection: null,
            thumbnailId: thumbnail?.id ?? null, thumbnailState: thumbnail ? 'available' : 'failed',
            metadataIssues: thumbnailError ? [...metadata.metadataIssues, `サムネイル未生成: ${thumbnailError}`] : metadata.metadataIssues,
            importedAt: now, updatedAt: now, deletedAt: null,
          });
          return { filename, hash, photo, thumbnail, thumbnailError, error: null };
        } catch (error) {
          if (error instanceof AutomaticJpegError && error.stopImport) { fatal.error = error; abort.abort(); }
          if (error instanceof DOMException && error.name === 'AbortError') {
            if (this.cancelled) job.lastError = error.message;
            return { ...cancelled(filename), reason: error.message };
          }
          // A prior input with this hash may still be preparing. Its successful
          // commit must win over a speculative metadata failure here.
          return { filename, hash, photo: null, thumbnail: null, thumbnailError: null, error: errorText(error) };
        }
      });
    };
    const names = files.map(file => Array.from(file.name.split(/[\\/]/).pop() || '名称不明').filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 255) || '名称不明');
    const pending = new Map<number, Promise<PreparedFile>>();
    const fillWindow = (index: number) => {
      if (this.cancelled || stopped || abort.signal.aborted) return;
      for (let next = index; next < Math.min(files.length, index + this.preparationConcurrency); next++) {
        if (!pending.has(next)) pending.set(next, readFile(files[next]!, names[next]!).catch(error => ({ filename: names[next]!, state: 'failed', reason: errorText(error), photoId: null })));
      }
    };
    const commit = async (prepared: PreparedFile): Promise<FileOutcome> => {
      if ('state' in prepared) return prepared;
      if (this.cancelled) return cancelled(prepared.filename);
      try {
        assertImageProcessingReady();
        // Preparation can overlap, but all commits and duplicate decisions are
        // ordered. Keep savePhoto's transactional validation as the final guard.
        const status = await duplicateStatus(prepared.hash);
        // A speculative worker can fail while the commit-side lookup awaits.
        // Recheck immediately before starting any new storage mutation.
        if (fatal.error) throw fatal.error;
        if (this.cancelled || stopped || abort.signal.aborted) return cancelled(prepared.filename);
        assertImageProcessingReady();
        if (status.skip) return duplicate(prepared.filename);
        if (!prepared.photo) throw new Error(prepared.error ?? '写真情報を準備できません');
        await this.db.savePhoto(prepared.photo, prepared.thumbnail, { allowDuplicateAcrossTrips: status.exception });
        return { filename: prepared.filename, state: prepared.thumbnail ? 'imported' : 'partial', reason: [status.exception ? '明示的に別の旅行へ重複写真として追加しました' : null, prepared.thumbnailError].filter(Boolean).join(' / ') || null, photoId: prepared.photo.id };
      } catch (error) {
        if (error instanceof AutomaticJpegError && error.stopImport) { fatal.error = error; abort.abort(); }
        return { filename: prepared.filename, state: 'failed', reason: errorText(error), photoId: null };
      }
    };
    const checkFatal = async () => {
      if (fatal.error) {
        const error = fatal.error;
        job.state = 'interrupted'; job.lastError = error.message;
        try { await publish(); }
        catch (secondary) { throw new AutomaticJpegError(error.code, true, { cause: secondary }); }
        throw error;
      }
    };
    fillWindow(0);
    try {
      for (let index = 0; index < files.length; index++) {
        const skip = this.cancelled;
        const prepared = await pending.get(index);
        pending.delete(index);
        await checkFatal();
        const outcome = skip ? cancelled(names[index]!) : await commit(prepared ?? cancelled(names[index]!));
        outcomes.push(outcome);
        if (outcome.state === 'failed') job.lastError = outcome.reason;
        job.processed++;
        await publish();
        await checkFatal();
        fillWindow(index + 1);
      }
      job.state = this.cancelled ? 'cancelled' : 'completed';
      if (this.cancelled) {
        try { assertImageProcessingReady(); }
        catch (error) { job.lastError = errorText(error); }
      }
      await publish();
      return { job: { ...job }, outcomes };
    } catch (error) {
      // Cleanup may interrupt an automatic decode even when the original
      // failure was a Job write or callback. Keep the reload requirement visible.
      abort.abort();
      if (error instanceof AutomaticJpegError && error.stopImport) throw error;
      try { assertImageProcessingReady(); }
      catch { throw new AutomaticJpegError('worker', true, { cause: error }); }
      throw error;
    } finally {
      stopped = true;
      abort.abort();
      await Promise.allSettled(pending.values());
      pending.clear();
      if (this.abort === abort) this.abort = null;
    }
  }
}
