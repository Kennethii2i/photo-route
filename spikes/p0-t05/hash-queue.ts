/** Disposable Phase 0 proof. Source bytes are never stored by this module. */
export type Input = { name: string; bytes: Blob };
export type Result = { name: string; sha256: string | null; status: 'imported' | 'duplicate' | 'failed' | 'cancelled'; error?: string };
export type Progress = { completed: number; total: number; active: number };

export async function sha256(input: Blob, maxBytes: number): Promise<string> {
  if (input.size > maxBytes) throw new RangeError('source byte limit exceeded');
  const buffer = await input.arrayBuffer();
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } finally {
    // The buffer is scoped to this invocation; Web Crypto does not expose a streaming digest.
  }
}

export async function hashQueue(
  inputs: readonly Input[],
  options: { concurrency: number; maxBytes: number; signal?: AbortSignal; existing?: ReadonlySet<string>; onProgress?: (progress: Progress) => void; onActive?: (active: number) => void },
): Promise<Result[]> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4) throw new RangeError('concurrency must be 1..4');
  const seen = new Set(options.existing);
  const results: Result[] = Array.from({ length: inputs.length });
  let next = 0;
  let completed = 0;
  let active = 0;
  const report = () => options.onProgress?.({ completed, total: inputs.length, active });
  report();
  async function worker(): Promise<void> {
    while (next < inputs.length) {
      const index = next++;
      const input = inputs[index];
      if (!input) continue;
      if (options.signal?.aborted) {
        results[index] = { name: input.name, sha256: null, status: 'cancelled' };
      } else {
        active++;
        options.onActive?.(active);
        report();
        try {
          const digest = await sha256(input.bytes, options.maxBytes);
          // A single JS turn owns this set check/add, including across workers.
          const duplicate = seen.has(digest);
          if (!duplicate) seen.add(digest);
          results[index] = { name: input.name, sha256: digest, status: duplicate ? 'duplicate' : 'imported' };
        } catch (error) {
          results[index] = { name: input.name, sha256: null, status: 'failed', error: String(error) };
        } finally {
          active--;
          options.onActive?.(active);
        }
      }
      completed++;
      report();
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, inputs.length) }, () => worker()));
  return results;
}
