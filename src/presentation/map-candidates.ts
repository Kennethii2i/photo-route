export type CandidateSource = { count: number; page: (offset: number, limit: number) => Promise<string[]> };

type Leaf = { properties?: { id?: unknown } | null };
type LeafSource = { getClusterLeaves: (clusterId: number, limit: number, offset: number) => Promise<Leaf[]> };

/** MapLibre retrieves only the requested page from its clustered GeoJSON index. */
export function clusterCandidateSource(source: LeafSource, clusterId: number, count: number, isCurrent: () => boolean): CandidateSource {
  return { count, page: async (offset, limit) => {
    if (!isCurrent()) return [];
    const leaves = await source.getClusterLeaves(clusterId, limit, offset);
    if (!isCurrent()) return [];
    return leaves.map(item => item.properties?.id).filter((id): id is string => typeof id === 'string');
  } };
}
