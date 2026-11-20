import { describe, expect, it } from 'vitest';
import type { Photo, PhotoAlbumLink, Trip, Visit } from '../../src/domain/model';
import { VisitPhotoDraft } from '../../src/presentation/visit-photo-draft';

const trip = { id: 'trip' } as Trip;
const visits = [
  { id: 'a', tripId: 'trip', label: 'A', deletedAt: null },
  { id: 'b', tripId: 'trip', label: 'B', deletedAt: null },
  { id: 'c', tripId: 'trip', label: 'C', deletedAt: '2026-01-01T00:00:00.000Z' },
] as Visit[];
const photos = ['a1', 'a2', 'free', 'b1', 'c1', 'deleted', 'other'].map(id => ({
  id, tripId: id === 'other' ? 'other-trip' : 'trip', visitId: null,
  deletedAt: id === 'deleted' ? '2026-01-01T00:00:00.000Z' : null,
})) as Photo[];
const links = [
  ['a1', 'a'], ['a2', 'a'], ['a2', 'b'], ['b1', 'b'], ['c1', 'c'],
].map(([photoId, albumId]) => ({ photoId, albumId, createdAt: null })) as PhotoAlbumLink[];

describe('album photo draft', () => {
  it('changes only the target link and keeps other and trashed album links intact', () => {
    const draft = new VisitPhotoDraft(trip, visits[0]!, photos, visits, links);
    expect(draft.photos.map(photo => photo.id)).toEqual(['a1', 'a2', 'free', 'b1', 'c1']);
    draft.choose('a1', false);
    draft.choose('free', true);
    draft.choose('b1', true);
    draft.choose('b1', false);
    draft.choose('c1', true);
    expect(draft.counts()).toEqual({ added: 2, removed: 1, selected: 3 });
    const request = draft.request('operation');
    expect(request.changes.map(change => [change.beforePhoto.id, change.afterAlbumIds])).toEqual([
      ['a1', []], ['free', ['a']], ['c1', ['c', 'a']],
    ]);
    expect(request.expectedAlbums.map(album => album.id).sort()).toEqual(['a', 'c']);
    expect(request.changes[2]?.expectedLinks).toEqual([{ photoId: 'c1', albumId: 'c', createdAt: null }]);
    expect(photos.every(photo => photo.visitId === null)).toBe(true);
    expect(links).toHaveLength(5);
  });

  it('can add a third album without moving the photo, and undoing a toggle creates no change', () => {
    const draft = new VisitPhotoDraft(trip, visits[0]!, photos, visits, links);
    draft.choose('b1', true);
    expect(draft.changes()[0]?.afterAlbumIds).toEqual(['b', 'a']);
    draft.choose('b1', false);
    expect(draft.changes()).toEqual([]);
    expect(draft.sourceName(photos[4]!)).toContain('ごみ箱');
  });

  it('rejects unknown albums and out-of-scope photos', () => {
    const draft = new VisitPhotoDraft(trip, visits[0]!, photos, visits.filter(visit => visit.id !== 'c'), links);
    draft.choose('c1', true);
    expect(() => draft.request('operation')).toThrow('所属アルバムを確認できません');
    expect(() => draft.choose('deleted', true)).toThrow('編集対象');
    expect(() => draft.choose('other', true)).toThrow('編集対象');
  });
});
