import type { Photo, PhotoAlbumLink, Trip, Visit } from '../domain/model';
import type { AlbumMembershipBatchRequest } from '../infrastructure/storage';

export type DraftCounts = { added: number; removed: number; selected: number };

/** An album editor changes only the target album's link; source records remain untouched. */
export class VisitPhotoDraft {
  readonly photos: Photo[];
  readonly byId: Map<string, Photo>;
  private readonly chosen: Set<string>;
  private readonly linksByPhoto = new Map<string, PhotoAlbumLink[]>();
  private readonly visitsById: Map<string, Visit>;

  constructor(readonly trip: Trip, readonly target: Visit, photos: Photo[], visits: Visit[], links: PhotoAlbumLink[]) {
    this.photos = photos.filter(photo => photo.tripId === trip.id && !photo.deletedAt);
    this.byId = new Map(this.photos.map(photo => [photo.id, photo]));
    this.visitsById = new Map(visits.map(visit => [visit.id, visit]));
    for (const link of links) {
      if (!this.byId.has(link.photoId)) continue;
      const current = this.linksByPhoto.get(link.photoId) ?? [];
      current.push(link); this.linksByPhoto.set(link.photoId, current);
    }
    this.chosen = new Set(this.photos.filter(photo => this.hasTargetLink(photo.id)).map(photo => photo.id));
  }

  private hasTargetLink(id: string): boolean {
    return this.linksByPhoto.get(id)?.some(link => link.albumId === this.target.id) ?? false;
  }
  originallySelected(id: string): boolean { return this.hasTargetLink(id); }
  selected(id: string): boolean { return this.chosen.has(id); }
  linkedPhotoIds(): ReadonlySet<string> { return new Set(this.linksByPhoto.keys()); }
  choose(id: string, include: boolean): void {
    if (!this.byId.has(id)) throw new Error('編集対象の写真が見つかりません');
    if (include) this.chosen.add(id); else this.chosen.delete(id);
  }

  sourceName(photo: Photo): string {
    const other = (this.linksByPhoto.get(photo.id) ?? [])
      .filter(link => link.albumId !== this.target.id)
      .map(link => {
        const album = this.visitsById.get(link.albumId);
        return album ? `${album.label}${album.deletedAt ? '（ごみ箱）' : ''}` : '確認できないアルバム';
      });
    return other.length ? `他のアルバム: ${other.join('、')}` : this.hasTargetLink(photo.id) ? 'このアルバムのみ' : 'アルバム未所属';
  }

  sourceSummary(photo: Photo): string {
    const other = (this.linksByPhoto.get(photo.id) ?? []).filter(link => link.albumId !== this.target.id);
    const trash = other.filter(link => this.visitsById.get(link.albumId)?.deletedAt).length;
    return other.length ? `他${other.length}アルバム${trash ? `（ごみ箱${trash}）` : ''}`
      : this.hasTargetLink(photo.id) ? 'このアルバムのみ' : '未所属';
  }

  changes(): AlbumMembershipBatchRequest['changes'] {
    return this.photos.flatMap(photo => {
      const before = this.hasTargetLink(photo.id);
      const after = this.chosen.has(photo.id);
      if (before === after) return [];
      const expectedLinks = this.linksByPhoto.get(photo.id) ?? [];
      const afterAlbumIds = expectedLinks.filter(link => link.albumId !== this.target.id).map(link => link.albumId);
      if (after) afterAlbumIds.push(this.target.id);
      return [{ beforePhoto: photo, expectedLinks: [...expectedLinks], afterAlbumIds }];
    });
  }

  counts(): DraftCounts {
    let added = 0, removed = 0;
    for (const photo of this.photos) {
      const before = this.hasTargetLink(photo.id), after = this.chosen.has(photo.id);
      if (!before && after) added++;
      if (before && !after) removed++;
    }
    return { added, removed, selected: this.chosen.size };
  }

  request(operationId: string): AlbumMembershipBatchRequest {
    const changes = this.changes();
    const required = new Set(changes.flatMap(change => [...change.expectedLinks.map(link => link.albumId), ...change.afterAlbumIds]));
    const expectedAlbums = [...required].map(id => {
      const album = this.visitsById.get(id);
      if (!album || album.tripId !== this.trip.id) throw new Error('所属アルバムを確認できません。最新状態を確認してください');
      return album;
    });
    return { operationId, expectedTrip: this.trip, expectedAlbums, changes };
  }
}
