import { validateAlbumLinks, validateRelations, type PhotoAlbumLink } from '../domain/model';
import type { RecoveryKind, Snapshot } from './storage';

export type TrashDeletionPlan = Readonly<{
  kind: RecoveryKind; id: string; label: string;
  trips: number; albums: number; photos: number; thumbnails: number; links: number;
}>;

export function trashDeletionContents(snapshot: Snapshot, kind: RecoveryKind, id: string): {
  plan: TrashDeletionPlan; remaining: Snapshot; tripIds: string[]; albumIds: string[];
  photoIds: string[]; thumbnailIds: string[]; links: PhotoAlbumLink[];
} {
  validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
  validateAlbumLinks(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.links);
  const target = kind === 'trip' ? snapshot.trips.find(item => item.id === id)
    : kind === 'visit' ? snapshot.visits.find(item => item.id === id) : snapshot.photos.find(item => item.id === id);
  if (!target?.deletedAt) throw new Error('ごみ箱の対象が見つかりません。内容を確認し直してください。');
  const tripIds = kind === 'trip' ? [id] : [];
  const albumIds = snapshot.visits.filter(item => kind === 'trip' ? item.tripId === id : kind === 'visit' && item.id === id).map(item => item.id);
  const photoIds = snapshot.photos.filter(item => kind === 'trip' ? item.tripId === id : kind === 'photo' && item.id === id).map(item => item.id);
  const albums = new Set(albumIds), photos = new Set(photoIds);
  if (snapshot.visits.some(item => !albums.has(item.id) && item.representativePhotoId && photos.has(item.representativePhotoId)))
    throw new Error('この写真はアルバムの旧代表写真として参照されています。参照を壊すため完全に削除できません。');
  const thumbnailIds = snapshot.thumbnails.filter(item => photos.has(item.photoId)).map(item => item.id);
  const thumbnails = new Set(thumbnailIds);
  const links = snapshot.links.filter(item => albums.has(item.albumId) || photos.has(item.photoId));
  const remaining = {
    trips: snapshot.trips.filter(item => !tripIds.includes(item.id)),
    visits: snapshot.visits.filter(item => !albums.has(item.id)),
    photos: snapshot.photos.filter(item => !photos.has(item.id)),
    thumbnails: snapshot.thumbnails.filter(item => !thumbnails.has(item.id)),
    links: snapshot.links.filter(item => !albums.has(item.albumId) && !photos.has(item.photoId)),
  };
  validateRelations(remaining.trips, remaining.visits, remaining.photos, remaining.thumbnails);
  validateAlbumLinks(remaining.trips, remaining.visits, remaining.photos, remaining.links);
  const label = 'name' in target ? target.name : 'label' in target ? target.label : target.originalFilename;
  const plan = Object.freeze({ kind, id, label, trips: tripIds.length, albums: albumIds.length,
    photos: photoIds.length, thumbnails: thumbnailIds.length, links: links.length });
  return { plan, remaining, tripIds, albumIds, photoIds, thumbnailIds, links };
}
