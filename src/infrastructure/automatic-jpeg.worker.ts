import { readLargeJpegSource, LargeJpegSourceError } from './large-jpeg-source';
import { AUTOMATIC_JPEG_FRAME_EDGE, AUTOMATIC_JPEG_FRAME_PIXELS, type AutomaticJpegResponse } from './automatic-jpeg-protocol';

type Decoder = { decode(input: { frameIndex: number }): Promise<{ image: VideoFrame }>; close(): void };
type DecoderConstructor = { new(input: { data: Uint8Array; type: string; desiredWidth: number; desiredHeight: number; transfer: ArrayBuffer[] }): Decoder; isTypeSupported(type: string): Promise<boolean> };
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<{ buffer: ArrayBuffer; photoId: string }>) => void; postMessage: (value: AutomaticJpegResponse) => void; ImageDecoder?: DecoderConstructor };
const validSize = (width: number, height: number) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= AUTOMATIC_JPEG_FRAME_EDGE && height <= AUTOMATIC_JPEG_FRAME_EDGE && width * height <= AUTOMATIC_JPEG_FRAME_PIXELS;
scope.onmessage = event => {
  void (async () => {
    let decoder: Decoder | undefined, frame: VideoFrame | undefined;
    let result: AutomaticJpegResponse;
    try {
      const bytes = new Uint8Array(event.data.buffer);
      const source = await readLargeJpegSource(bytes);
      const Decoder = scope.ImageDecoder;
      if (!Decoder || typeof OffscreenCanvas === 'undefined' || !await Decoder.isTypeSupported('image/jpeg')) {
        result = { ok: false, code: 'unsupported' };
      } else {
        const ratio = Math.min(1, 512 / Math.max(source.width, source.height));
        decoder = new Decoder({ data: bytes, type: 'image/jpeg', desiredWidth: Math.max(1, Math.round(source.width * ratio)), desiredHeight: Math.max(1, Math.round(source.height * ratio)), transfer: [event.data.buffer] });
        frame = (await decoder.decode({ frameIndex: 0 })).image;
        const visible = frame.visibleRect;
        if (!validSize(frame.codedWidth, frame.codedHeight) || !validSize(frame.displayWidth, frame.displayHeight) || !visible || visible.x !== 0 || visible.y !== 0 || visible.width !== frame.codedWidth || visible.height !== frame.codedHeight) {
          result = { ok: false, code: 'size' };
        } else {
          const expected = [[0, false], [0, true], [180, false], [180, true], [90, true], [90, false], [270, true], [270, false]][(source.metadata.sourceOrientation ?? 1) - 1]!;
          const orientation = frame as VideoFrame & { rotation?: number; flip?: boolean };
          const swap = expected[0] === 90 || expected[0] === 270;
          if ((orientation.rotation ?? 0) !== expected[0] || (orientation.flip ?? false) !== expected[1] || frame.displayWidth !== (swap ? frame.codedHeight : frame.codedWidth) || frame.displayHeight !== (swap ? frame.codedWidth : frame.codedHeight)) {
            result = { ok: false, code: 'unsupported' };
          } else {
            const scale = Math.min(1, 512 / Math.max(frame.displayWidth, frame.displayHeight));
            const width = Math.max(1, Math.round(frame.displayWidth * scale)), height = Math.max(1, Math.round(frame.displayHeight * scale));
            const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas unavailable');
            context.imageSmoothingQuality = 'high'; context.drawImage(frame, 0, 0, width, height);
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
            if (!blob.size || blob.size > 1024 * 1024 || blob.type !== 'image/jpeg') throw new Error('Invalid thumbnail');
            result = { ok: true, metadata: source.metadata, thumbnail: { id: crypto.randomUUID(), photoId: event.data.photoId, mime: 'image/jpeg', width, height, byteLength: blob.size, blob } };
          }
        }
      }
    } catch (error) { result = { ok: false, code: error instanceof LargeJpegSourceError ? error.code : 'invalid' }; }
    finally { frame?.close(); decoder?.close(); }
    scope.postMessage(result);
  })();
};
