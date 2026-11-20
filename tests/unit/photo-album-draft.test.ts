import { describe, expect, it } from 'vitest';
import type { Photo, PhotoAlbumLink, Trip, Visit } from '../../src/domain/model';
import { PhotoAlbumDraft } from '../../src/presentation/photo-album-draft';

const trip = { id: 'trip', deletedAt: null } as Trip;
const photo = { id: 'photo', tripId: 'trip', visitId: null, deletedAt: null } as Photo;
const albums = [
  { id: 'a', label: 'A', tripId: 'trip', deletedAt: null },
  { id: 'b', label: 'B', tripId: 'trip', deletedAt: null },
  { id: 'c', label: 'C', tripId: 'trip', deletedAt: null },
  { id: 'trash', label: 'Trash', tripId: 'trip', deletedAt: '2026-01-01' },
  { id: 'other', label: 'Other', tripId: 'other-trip', deletedAt: null },
] as Visit[];
const links = ['a', 'b', 'trash'].map(albumId => ({ albumId, photoId: 'photo', createdAt: null })) as PhotoAlbumLink[];

describe('photo album draft', () => {
  it('edits active memberships and keeps the trash link and source photo untouched', () => {
    const draft = new PhotoAlbumDraft(photo, trip, albums, links);
    expect(draft.counts()).toEqual({ current: 2, added: 0, removed: 0, trash: 1 });
    expect(draft.isDirty).toBe(false);
    draft.choose('b', false); draft.choose('c', true);
    expect(draft.counts()).toEqual({ current: 2, added: 1, removed: 1, trash: 1 });
    const request = draft.request('operation');
    expect(request.changes).toEqual([{ beforePhoto: photo, expectedLinks: links, afterAlbumIds: ['trash', 'a', 'c'] }]);
    expect(request.expectedAlbums.map(album => album.id).sort()).toEqual(['a', 'b', 'c', 'trash']);
    expect(links.map(link => link.albumId)).toEqual(['a', 'b', 'trash']);
    expect(photo.visitId).toBeNull();
  });
  it('does not move groups while toggling and cannot edit trash or other Trip albums', () => {
    const draft = new PhotoAlbumDraft(photo, trip, albums, links);
    expect([...draft.initialActiveIds]).toEqual(['a', 'b']);
    draft.choose('b', false); draft.choose('b', true);
    expect(draft.isDirty).toBe(false);
    expect(() => draft.choose('trash', true)).toThrow('編集できません');
    expect(() => draft.choose('other', true)).toThrow('編集できません');
    expect(() => new PhotoAlbumDraft({ ...photo, tripId: null }, trip, albums, links)).toThrow('編集の対象');
  });
});
