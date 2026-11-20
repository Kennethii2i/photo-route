/** Test-only browser harness: receives synthetic bytes in memory, never fetches images. */
import exifr from 'exifr';
import ExifReader from 'exifreader';
import { deriveSourceGps, deriveSourceTime, selectSourceTags } from './source-semantics';

declare global {
  interface Window {
    p0ExifProbe?: {
      read(bytes: Uint8Array): Promise<{
        fileType: string | undefined;
        rawOrientation: unknown;
        rawDateTimeOriginal: unknown;
        rawOffsetTimeOriginal: unknown;
        rawGpsLatitude: unknown;
        capturedAtUtc: string | null;
        gpsStatus: string;
        exifrFailure: string | null;
      }>;
    };
  }
}

window.p0ExifProbe = {
  async read(bytes) {
    const reader = await ExifReader.load(bytes, { expanded: true });
    const raw = selectSourceTags(reader.exif);
    let exifrFailure: string | null;
    try {
      const parsed = await exifr.parse(bytes);
      exifrFailure = parsed?.errors?.[0]?.message ?? null;
    } catch (error) {
      exifrFailure = error instanceof Error ? error.message : String(error);
    }
    return {
      fileType: reader.file?.FileType?.value,
      rawOrientation: raw.orientation,
      rawDateTimeOriginal: raw.dateTimeOriginal,
      rawOffsetTimeOriginal: raw.offsetTimeOriginal,
      rawGpsLatitude: raw.gpsLatitude,
      capturedAtUtc: deriveSourceTime(raw).capturedAtUtc,
      gpsStatus: deriveSourceGps(raw).status,
      exifrFailure,
    };
  },
};
