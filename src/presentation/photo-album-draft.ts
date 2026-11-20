import type { Photo, PhotoAlbumLink, Trip, Visit } from '../domain/model';
import type { AlbumMembershipBatchRequest } from '../infrastructure/storage';

/** The saved links, including trash links, are immutable expectations for one Photo edit. */
export class PhotoAlbumDraft {
  readonly activeAlbums: Visit[];
  readonly initialActiveIds: ReadonlySet<string>;
  private readonly selectedIds: Set<string>;
  private readonly originalIds: ReadonlySet<string>;
  private readonly albumById: Map<string, Visit>;

  constructor(readonly photo: Photo, readonly trip: Trip, albums: Visit[], readonly links: PhotoAlbumLink[]) {
    if (photo.deletedAt || trip.deletedAt || photo.tripId !== trip.id || photo.visitId !== null)
      throw new Error('この写真はアルバム編集の対象にできません');
    this.albumById = new Map(albums.map(album => [album.id, album]));
    this.activeAlbums = albums.filter(album => album.tripId === trip.id && !album.deletedAt);
    this.originalIds = new Set(links.map(link => link.albumId));
    this.initialActiveIds = new Set(this.activeAlbums.filter(album => this.originalIds.has(album.id)).map(album => album.id));
    this.selectedIds = new Set(this.initialActiveIds);
  }

  get isDirty(): boolean { return this.counts().added + this.counts().removed > 0; }
  selected(id: string): boolean { return this.selectedIds.has(id); }
  choose(id: string, include: boolean): void {
    if (!this.activeAlbums.some(album => album.id === id)) throw new Error('このアルバムは編集できません');
    if (include) this.selectedIds.add(id); else this.selectedIds.delete(id);
  }
  counts(): { current: number; added: number; removed: number; trash: number } {
    let added = 0, removed = 0;
    for (const album of this.activeAlbums) {
      if (this.selectedIds.has(album.id) && !this.originalIds.has(album.id)) added++;
      if (!this.selectedIds.has(album.id) && this.originalIds.has(album.id)) removed++;
    }
    return { current: this.initialActiveIds.size, added, removed,
      trash: this.links.filter(link => this.albumById.get(link.albumId)?.deletedAt).length };
  }
  request(operationId: string): AlbumMembershipBatchRequest {
    const afterAlbumIds = [...new Set([
      ...this.links.filter(link => !this.activeAlbums.some(album => album.id === link.albumId)).map(link => link.albumId),
      ...this.selectedIds,
    ])];
    const requiredIds = new Set([...this.links.map(link => link.albumId), ...afterAlbumIds]);
    const expectedAlbums = [...requiredIds].map(id => {
      const album = this.albumById.get(id);
      if (!album || album.tripId !== this.trip.id) throw new Error('所属アルバムを確認できません。最新状態を確認してください');
      return album;
    });
    return { operationId, expectedTrip: this.trip, expectedAlbums,
      changes: [{ beforePhoto: this.photo, expectedLinks: [...this.links], afterAlbumIds }] };
  }
}
