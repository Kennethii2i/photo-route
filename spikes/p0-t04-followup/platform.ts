import { decodeHeic, probeSupport } from '@su-engineering/heic';

type PlatformResult = {
  status: 'ok' | 'failed';
  strategy?: string;
  width?: number;
  height?: number;
  reason?: string;
  elapsedMs: number;
};

async function decode(bytes: Uint8Array): Promise<PlatformResult> {
  const started = performance.now();
  try {
    const result = await decodeHeic(new Uint8Array(bytes), { maxDimension: 8 });
    try {
      return { status: 'ok', strategy: result.strategy, width: result.width, height: result.height, elapsedMs: performance.now() - started };
    } finally {
      result.image.close();
    }
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error), elapsedMs: performance.now() - started };
  }
}

declare global {
  interface Window { p0PlatformProbe?: { decode: typeof decode; support: typeof probeSupport } }
}
window.p0PlatformProbe = { decode, support: probeSupport };
