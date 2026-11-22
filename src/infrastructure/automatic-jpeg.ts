import { photoSchema, thumbnailMetaSchema } from '../domain/model';
import { inspectImage, MAX_SOURCE_BYTES } from './image';
import { AUTOMATIC_JPEG_TIMEOUT_MS, automaticJpegMessage, type AutomaticJpegCode, type AutomaticJpegResponse } from './automatic-jpeg-protocol';

let blocked = false;
let active = false;
export class AutomaticJpegError extends Error {
  constructor(readonly code: AutomaticJpegCode, readonly stopImport = false, options?: ErrorOptions) { super(automaticJpegMessage(code), options); this.name = 'AutomaticJpegError'; }
}
export function assertImageProcessingReady(): void { if (blocked) throw new AutomaticJpegError('worker', true); }

export function makeAutomaticJpeg(bytes: Uint8Array, photoId: string, signal: AbortSignal): Promise<Extract<AutomaticJpegResponse, { ok: true }>> {
  assertImageProcessingReady(); signal.throwIfAborted();
  if (active) throw new AutomaticJpegError('busy');
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) throw new AutomaticJpegError('size');
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./automatic-jpeg.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new AutomaticJpegError('unsupported')); return; }
    active = true;
    let settled = false;
    const finish = (error?: Error, value?: Extract<AutomaticJpegResponse, { ok: true }>) => {
      if (settled) return; settled = true;
      active = false;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
      if (error instanceof AutomaticJpegError && error.stopImport) blocked = true;
      if (error) reject(error); else if (value) resolve(value); else reject(new AutomaticJpegError('protocol', true));
    };
    const abort = () => {
      // terminate cannot acknowledge completion of native decoding. Prevent
      // cancel/retry from stacking work that the browser may still be releasing.
      blocked = true;
      finish(new DOMException('利用者が中断しました。続けて取り込むにはページを再読み込みしてください。', 'AbortError'));
    };
    const timer = setTimeout(() => finish(new AutomaticJpegError('timeout', true)), AUTOMATIC_JPEG_TIMEOUT_MS);
    worker.onerror = () => finish(new AutomaticJpegError('worker', true));
    worker.onmessageerror = () => finish(new AutomaticJpegError('protocol', true));
    worker.onmessage = (event: MessageEvent<AutomaticJpegResponse>) => {
      void (async () => {
        try {
          if (event.data?.ok === false && ['unsupported', 'size', 'invalid'].includes(event.data.code)) { finish(new AutomaticJpegError(event.data.code)); return; }
          if (event.data?.ok !== true) throw new Error('Invalid response');
          const { blob, ...meta } = event.data.thumbnail;
          thumbnailMetaSchema.parse(meta);
          if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || blob.size !== meta.byteLength || meta.photoId !== photoId || meta.width > 512 || meta.height > 512) throw new Error('Invalid thumbnail response');
          const shape = inspectImage(new Uint8Array(await blob.arrayBuffer()));
          if (shape.mime !== 'image/jpeg' || shape.width !== meta.width || shape.height !== meta.height) throw new Error('Invalid output image');
          const metadata = {
            sourceGps: photoSchema.shape.sourceGps.parse(event.data.metadata?.sourceGps),
            sourceTime: photoSchema.shape.sourceTime.parse(event.data.metadata?.sourceTime),
            sourceOrientation: photoSchema.shape.sourceOrientation.parse(event.data.metadata?.sourceOrientation),
            metadataIssues: photoSchema.shape.metadataIssues.parse(event.data.metadata?.metadataIssues),
          };
          finish(undefined, { ...event.data, metadata });
        } catch { finish(new AutomaticJpegError('protocol', true)); }
      })();
    };
    signal.addEventListener('abort', abort, { once: true });
    try { worker.postMessage({ buffer: bytes.buffer, photoId }, [bytes.buffer]); }
    catch { finish(new AutomaticJpegError('protocol', true)); }
  });
}
