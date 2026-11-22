import type { Photo, Thumbnail } from '../domain/model';

export const AUTOMATIC_JPEG_TIMEOUT_MS = 5000;
export const AUTOMATIC_JPEG_FRAME_PIXELS = 1_000_000;
export const AUTOMATIC_JPEG_FRAME_EDGE = 8192;
export type SourceMetadata = Pick<Photo, 'sourceGps' | 'sourceTime' | 'sourceOrientation' | 'metadataIssues'>;
export type AutomaticJpegCode = 'unsupported' | 'size' | 'invalid' | 'timeout' | 'worker' | 'protocol' | 'busy';
export type AutomaticJpegResponse = { ok: true; metadata: SourceMetadata; thumbnail: Thumbnail } | { ok: false; code: AutomaticJpegCode };
export const automaticJpegMessage = (code: AutomaticJpegCode): string => ({
  unsupported: 'このブラウザ、またはこのJPEGの保存形式では、大きな写真の表示用画像を作れません。',
  size: 'この写真は、安全に処理できる大きさを超えています。',
  invalid: '写真の画像データを読み取れません。',
  timeout: '処理に時間がかかったため、安全のため取り込みを停止しました。再開するにはページを再読み込みしてください。',
  worker: '画像処理を停止しました。再開するにはページを再読み込みしてください。',
  protocol: '画像処理の結果を確認できません。再開するにはページを再読み込みしてください。',
  busy: '別の大きな写真を処理しています。処理が終わってから選び直してください。',
}[code]);
