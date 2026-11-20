import buildLibheif from '../../node_modules/heic-to/src/lib/libheif.js';

try {
  const module = await buildLibheif();
  const raw = module.heif_get_version_number();
  globalThis.p0HeicVersions = {
    heifRaw: raw,
    heifHex: raw.toString(16),
  };
} catch (error) {
  globalThis.p0HeicVersions = { error: String(error) };
}
