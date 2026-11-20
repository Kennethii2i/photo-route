import { describe, expect, it } from 'vitest';
import { hashQueue, sha256, type Input, type Progress } from '../../spikes/p0-t05/hash-queue';

const blob = (text: string) => new Blob([text]);

describe('P0-T05 local SHA-256 and bounded queue', () => {
  it('uses bytes, not filenames, and skips exact duplicates', async () => {
    const inputs: Input[] = [
      { name: 'same.jpg', bytes: blob('A') },
      { name: 'same.jpg', bytes: blob('B') },
      { name: 'other.jpg', bytes: blob('A') },
    ];
    const progress: Progress[] = [];
    const active: number[] = [];
    const results = await hashQueue(inputs, { concurrency: 2, maxBytes: 1024, onProgress: value => progress.push(value), onActive: value => active.push(value) });
    expect(results.map(result => result.status)).toEqual(['imported', 'imported', 'duplicate']);
    expect(results[0]?.sha256).toEqual(results[2]?.sha256);
    expect(results[0]?.sha256).not.toEqual(results[1]?.sha256);
    expect(results[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Math.max(...active)).toBeLessThanOrEqual(2);
    expect(progress.at(-1)).toEqual({ completed: 3, total: 3, active: 0 });
  });

  it('skips a digest already present in local metadata', async () => {
    const digest = await sha256(blob('A'), 1024);
    const result = await hashQueue([{ name: 'renamed.jpg', bytes: blob('A') }], { concurrency: 1, maxBytes: 1024, existing: new Set([digest]) });
    expect(result[0]?.status).toBe('duplicate');
  });

  it('rejects oversized input and invalid concurrency without retaining input', async () => {
    const input = [{ name: 'large.jpg', bytes: blob('12345') }];
    expect((await hashQueue(input, { concurrency: 1, maxBytes: 4 }))[0]?.status).toBe('failed');
    await expect(hashQueue(input, { concurrency: 0, maxBytes: 10 })).rejects.toThrow('concurrency');
  });

  it('marks queued work cancelled after an abort', async () => {
    const controller = new AbortController();
    const inputs = Array.from({ length: 8 }, (_, index) => ({ name: `${index}.jpg`, bytes: blob(`${index}`) }));
    const result = await hashQueue(inputs, { concurrency: 1, maxBytes: 1024, signal: controller.signal, onProgress: ({ completed }) => { if (completed === 1) controller.abort(); } });
    expect(result.map(value => value.status)).toEqual(['imported', ...Array<string>(7).fill('cancelled')]);
  });
});
