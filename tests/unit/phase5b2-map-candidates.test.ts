import { describe, expect, it, vi } from 'vitest';
import { clusterCandidateSource } from '../../src/presentation/map-candidates';

describe('cluster candidate paging', () => {
  it('requests only the current 100 candidates from MapLibre', async () => {
    const getClusterLeaves = vi.fn(async (_clusterId: number, limit: number, offset: number) =>
      Array.from({ length: limit }, (_, index) => ({ properties: { id: `photo-${offset + index}` } })));
    const candidates = clusterCandidateSource({ getClusterLeaves }, 42, 1500, () => true);
    expect(candidates.count).toBe(1500);
    expect(await candidates.page(0, 100)).toHaveLength(100);
    expect(await candidates.page(100, 100)).toHaveLength(100);
    expect(getClusterLeaves.mock.calls).toEqual([[42, 100, 0], [42, 100, 100]]);
  });
  it('rejects stale source results without displaying old photos', async () => {
    let current = true;
    const source = clusterCandidateSource({ getClusterLeaves: async () => { current = false; return [{ properties: { id: 'old-photo' } }]; } }, 1, 1, () => current);
    expect(await source.page(0, 1)).toEqual([]);
  });
});
