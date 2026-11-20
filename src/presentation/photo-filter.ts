import type { Photo } from '../domain/model';
import { sourceGpsDisplay } from '../domain/gps';
import { photoDay } from './photo-grid';

export type PhotoFilter = {
  filename: string;
  fromDay: string;
  toDay: string;
  gps: 'all' | 'confirmed' | 'reference' | 'none';
  visit: 'all' | 'linked' | 'unlinked' | `album:${string}`;
};

export const emptyPhotoFilter = (): PhotoFilter => ({ filename: '', fromDay: '', toDay: '', gps: 'all', visit: 'all' });

export function isPhotoFilterActive(filter: PhotoFilter): boolean {
  return Boolean(filter.filename.trim() || filter.fromDay || filter.toDay || filter.gps !== 'all' || filter.visit !== 'all');
}

export function filterPhotos(photos: Photo[], filter: PhotoFilter, linkedPhotoIds: ReadonlySet<string>, albumsByPhoto: ReadonlyMap<string, readonly string[]> = new Map()): Photo[] {
  const name = filter.filename.trim().normalize('NFKC').toLocaleLowerCase();
  return photos.filter(photo => {
    if (name && !photo.originalFilename.normalize('NFKC').toLocaleLowerCase().includes(name)) return false;
    if (filter.fromDay || filter.toDay) {
      const day = photoDay(photo);
      if (!day || filter.fromDay && day < filter.fromDay || filter.toDay && day > filter.toDay) return false;
    }
    if (filter.visit === 'linked' && !linkedPhotoIds.has(photo.id) || filter.visit === 'unlinked' && linkedPhotoIds.has(photo.id)) return false;
    if (filter.visit.startsWith('album:') && !albumsByPhoto.get(photo.id)?.includes(filter.visit.slice(6))) return false;
    if (filter.gps !== 'all') {
      const source = sourceGpsDisplay(photo.sourceGps);
      const state = photo.gpsCorrection ? 'confirmed' : source.state === 'reference' ? 'reference' : source.point ? 'confirmed' : 'none';
      if (state !== filter.gps) return false;
    }
    return true;
  });
}
