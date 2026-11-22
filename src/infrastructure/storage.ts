import { photoAlbumLinkSchema, photoSchema, thumbnailMetaSchema, tripSchema, validateAlbumLinks, validateRelations, visitSchema, type Photo, type PhotoAlbumLink, type Thumbnail, type Trip, type Visit } from '../domain/model';

const DB_VERSION = 3;
const B1_MEMBERSHIP_GUARD = '複数アルバム所属への移行中です。この操作はPhase B2以降で利用できます';
export type ImportJob = { id: string; startedAt: string; targetTripId: string | null; total: number; processed: number; state: 'running' | 'completed' | 'cancelled' | 'interrupted'; lastError: string | null };
export type Snapshot = { trips: Trip[]; visits: Visit[]; photos: Photo[]; thumbnails: Thumbnail[]; links: PhotoAlbumLink[] };
type RestoreSeed = Omit<Snapshot, 'links'> & { links?: PhotoAlbumLink[] };
export type RecoveryKind = 'trip' | 'visit' | 'photo';
export type LegacyRecoveryEntry = { sequence?: number; id: string; kind: RecoveryKind; action: string; targetId: string; createdAt: string; before: Trip | Visit | Photo; after: Trip | Visit | Photo; undoneAt: string | null };
export type PhotoVisitBatchChange = { before: Photo; nextVisitId: string | null; expectedSourceVisit?: Visit };
export type PhotoVisitBatchRequest = { operationId: string; expectedTrip: Trip; expectedTargetVisit: Visit; changes: PhotoVisitBatchChange[] };
export type PhotoVisitBatchResult = { status: 'saved' | 'no-change'; operationId: string; changed: number; added: number; removed: number; transferred: number };
export type BatchRecoveryEntry = { sequence?: number; id: string; kind: 'photo-visit-batch'; action: string; targetId: string; createdAt: string; changes: { before: Photo; afterVisitId: string | null; afterUpdatedAt: string }[]; undoneAt: string | null };
export type AlbumMembershipChange = { beforePhoto: Photo; expectedLinks: PhotoAlbumLink[]; afterAlbumIds: string[] };
export type AlbumMembershipBatchRequest = { operationId: string; expectedTrip: Trip; expectedAlbums: Visit[]; changes: AlbumMembershipChange[] };
export type AlbumMembershipBatchResult = { status: 'saved' | 'no-change' | 'already-applied'; operationId: string; changedPhotos: number; added: number; removed: number };
export type AlbumMembershipRecoveryEntry = { sequence?: number; id: string; kind: 'photo-album-batch'; action: string; targetId: string; createdAt: string;
  requestHash: string; expectedTrip: Trip; expectedAlbums: Visit[]; changes: { beforePhoto: Photo; beforeLinks: PhotoAlbumLink[]; afterLinks: PhotoAlbumLink[] }[]; undoneAt: string | null };
export type RecoveryEntry = LegacyRecoveryEntry | BatchRecoveryEntry | AlbumMembershipRecoveryEntry;
export type AlbumMembershipOperationStatus = 'absent' | 'applied' | 'undone' | 'changed-after-save' | 'unknown';
export class EditConflict extends Error {
  constructor() { super('別の画面で保存内容が変更されました。入力を保持しています。最新状態を確認してから保存してください。'); this.name = 'EditConflict'; }
}
export class AlbumMembershipConflict extends Error {
  readonly needsReload = true;
  constructor(public readonly photoId: string | null, public readonly reason: string) {
    super(`アルバム所属の競合があります (${reason}${photoId ? `: ${photoId}` : ''})`);
    this.name = 'AlbumMembershipConflict';
  }
}
export class PhotoVisitBatchConflict extends Error {
  constructor(public readonly photoId: string | null, public readonly reason: string) {
    super(`写真所属の一括保存に競合があります (${reason}${photoId ? `: ${photoId}` : ''})`);
    this.name = 'PhotoVisitBatchConflict';
  }
}
// Photo records contain JSON-compatible values only. Ignore object key insertion order, but compare every field.
const sameRecord = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameRecord(value, right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameRecord(a[key], b[key]));
};
const sortedIds = (ids: string[]): string[] => [...ids].sort((a, b) => a.localeCompare(b));
const sortedLinks = (links: PhotoAlbumLink[]): PhotoAlbumLink[] => [...links].sort((a, b) => a.albumId.localeCompare(b.albumId));
const linkIds = (links: PhotoAlbumLink[]): string[] => sortedIds(links.map(link => link.albumId));
const expectedLegacyLinks = (visitId: string | null, photoId: string): PhotoAlbumLink[] =>
  visitId ? [{ albumId: visitId, photoId, createdAt: null }] : [];
const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const requestHash = async (input: AlbumMembershipBatchRequest): Promise<string> => {
  const normalized = { trip: input.expectedTrip, albums: [...input.expectedAlbums].sort((a, b) => a.id.localeCompare(b.id)),
    changes: [...input.changes].sort((a, b) => a.beforePhoto.id.localeCompare(b.beforePhoto.id)).map(change => ({
      beforePhoto: change.beforePhoto, expectedLinks: sortedLinks(change.expectedLinks), afterAlbumIds: sortedIds(change.afterAlbumIds),
    })) };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(normalized)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};
const readPhotoLinks = async (tx: IDBTransaction, photoId: string): Promise<PhotoAlbumLink[]> =>
  sortedLinks(await request<PhotoAlbumLink[]>(tx.objectStore('photoAlbumLinks').index('byPhoto').getAll(photoId)));
const replacePhotoLinks = (tx: IDBTransaction, current: PhotoAlbumLink[], desired: PhotoAlbumLink[]): void => {
  const store = tx.objectStore('photoAlbumLinks');
  const next = new Map(desired.map(link => [link.albumId, link]));
  const previous = new Map(current.map(link => [link.albumId, link]));
  for (const link of current) if (!next.has(link.albumId)) store.delete([link.albumId, link.photoId]);
  for (const link of desired) if (!sameRecord(previous.get(link.albumId), link)) store.put(link);
};
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed')); });
const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
});
const newestUndoable = (store: IDBObjectStore) => new Promise<RecoveryEntry | undefined>((resolve, reject) => {
  const cursor = store.openCursor(null, 'prev');
  cursor.onerror = () => reject(cursor.error ?? new Error('保存履歴を読み取れません'));
  cursor.onsuccess = () => {
    const found = cursor.result;
    if (!found) resolve(undefined);
    else if (!(found.value as RecoveryEntry).undoneAt) resolve(found.value as RecoveryEntry);
    else found.continue();
  };
});
const recoveryById = (store: IDBObjectStore, id: string) => new Promise<RecoveryEntry | undefined>((resolve, reject) => {
  const cursor = store.openCursor(null, 'prev');
  cursor.onerror = () => reject(cursor.error ?? new Error('保存履歴を読み取れません'));
  cursor.onsuccess = () => {
    const found = cursor.result;
    if (!found) resolve(undefined);
    else if ((found.value as RecoveryEntry).id === id) resolve(found.value as RecoveryEntry);
    else found.continue();
  };
});
const albumEntryApplied = async (tx: IDBTransaction, entry: AlbumMembershipRecoveryEntry): Promise<boolean> => {
  for (const change of entry.changes) {
    const photo: Photo | undefined = await request(tx.objectStore('photos').get(change.beforePhoto.id));
    if (!sameRecord(photo, change.beforePhoto) || !sameRecord(await readPhotoLinks(tx, change.beforePhoto.id), sortedLinks(change.afterLinks))) return false;
  }
  return true;
};
const assertLegacyAlbum = async (tx: IDBTransaction, photo: Photo, albumId: string | null): Promise<void> => {
  if (!albumId) return;
  const album: Visit | undefined = await request(tx.objectStore('visits').get(albumId));
  if (!album || album.tripId !== photo.tripId) throw new AlbumMembershipConflict(photo.id, 'legacy-album-invalid');
};
const undoAlbumBatch = async (tx: IDBTransaction, entry: AlbumMembershipRecoveryEntry): Promise<void> => {
  tripSchema.parse(entry.expectedTrip);
  const trip: Trip | undefined = await request(tx.objectStore('trips').get(entry.expectedTrip.id));
  if (!sameRecord(trip, entry.expectedTrip)) throw new AlbumMembershipConflict(null, 'undo-trip-changed');
  const albumIds = new Set<string>();
  for (const expected of entry.expectedAlbums) {
    visitSchema.parse(expected);
    if (albumIds.has(expected.id) || expected.tripId !== entry.expectedTrip.id) throw new AlbumMembershipConflict(null, 'undo-history-invalid');
    albumIds.add(expected.id);
    const album: Visit | undefined = await request(tx.objectStore('visits').get(expected.id));
    if (!sameRecord(album, expected)) throw new AlbumMembershipConflict(null, 'undo-album-changed');
  }
  const currentLinks: PhotoAlbumLink[][] = [];
  const seen = new Set<string>();
  for (const change of entry.changes) {
    photoSchema.parse(change.beforePhoto);
    if (seen.has(change.beforePhoto.id)) throw new AlbumMembershipConflict(change.beforePhoto.id, 'undo-duplicate-photo-id');
    seen.add(change.beforePhoto.id);
    if (change.beforePhoto.tripId !== entry.expectedTrip.id || change.beforePhoto.visitId !== null)
      throw new AlbumMembershipConflict(change.beforePhoto.id, 'undo-history-invalid');
    for (const links of [change.beforeLinks, change.afterLinks]) {
      const linked = new Set<string>();
      for (const link of links) {
        photoAlbumLinkSchema.parse(link);
        if (link.photoId !== change.beforePhoto.id || !albumIds.has(link.albumId) || linked.has(link.albumId))
          throw new AlbumMembershipConflict(change.beforePhoto.id, 'undo-history-invalid');
        linked.add(link.albumId);
      }
    }
    const photo: Photo | undefined = await request(tx.objectStore('photos').get(change.beforePhoto.id));
    const links = await readPhotoLinks(tx, change.beforePhoto.id);
    if (!sameRecord(photo, change.beforePhoto)) throw new AlbumMembershipConflict(change.beforePhoto.id, 'undo-photo-changed');
    if (!sameRecord(links, sortedLinks(change.afterLinks))) throw new AlbumMembershipConflict(change.beforePhoto.id, 'undo-membership-changed');
    currentLinks.push(links);
  }
  entry.changes.forEach((change, index) => replacePhotoLinks(tx, currentLinks[index]!, change.beforeLinks));
};
const undoLegacyBatch = async (tx: IDBTransaction, entry: BatchRecoveryEntry): Promise<void> => {
  const currentLinks: PhotoAlbumLink[][] = [];
  const seen = new Set<string>();
  for (const change of entry.changes) {
    const before = photoSchema.parse(change.before);
    if (seen.has(before.id)) throw new AlbumMembershipConflict(before.id, 'undo-duplicate-photo-id');
    seen.add(before.id);
    const current: Photo | undefined = await request(tx.objectStore('photos').get(before.id));
    const expected = { ...before, visitId: null, updatedAt: change.afterUpdatedAt };
    if (!sameRecord(current, expected)) throw new AlbumMembershipConflict(before.id, 'undo-photo-changed');
    const links = await readPhotoLinks(tx, before.id);
    if (!sameRecord(links, expectedLegacyLinks(change.afterVisitId, before.id)))
      throw new AlbumMembershipConflict(before.id, 'undo-legacy-membership-changed');
    if (before.tripId) {
      const trip: Trip | undefined = await request(tx.objectStore('trips').get(before.tripId));
      if (!trip) throw new AlbumMembershipConflict(before.id, 'undo-trip-missing');
    }
    await assertLegacyAlbum(tx, before, before.visitId);
    await assertLegacyAlbum(tx, before, change.afterVisitId);
    currentLinks.push(links);
  }
  entry.changes.forEach((change, index) => {
    const before = change.before;
    replacePhotoLinks(tx, currentLinks[index]!, expectedLegacyLinks(before.visitId, before.id));
    tx.objectStore('photos').put(photoSchema.parse({ ...before, visitId: null }));
  });
};
const undoLegacyEntry = async (tx: IDBTransaction, entry: LegacyRecoveryEntry): Promise<void> => {
  const store = tx.objectStore(entry.kind === 'trip' ? 'trips' : entry.kind === 'visit' ? 'visits' : 'photos');
  if (entry.kind === 'photo') {
    const before = photoSchema.parse(entry.before), after = photoSchema.parse(entry.after);
    if (before.id !== after.id || before.tripId !== after.tripId) throw new AlbumMembershipConflict(before.id, 'legacy-history-invalid');
    const current: Photo | undefined = await request(store.get(entry.targetId));
    if (!sameRecord(current, { ...after, visitId: null })) throw new AlbumMembershipConflict(before.id, 'undo-photo-changed');
    if (before.visitId !== after.visitId) {
      const links = await readPhotoLinks(tx, before.id);
      if (!sameRecord(links, expectedLegacyLinks(after.visitId, before.id)))
        throw new AlbumMembershipConflict(before.id, 'undo-legacy-membership-changed');
      await assertLegacyAlbum(tx, before, before.visitId);
      await assertLegacyAlbum(tx, before, after.visitId);
      replacePhotoLinks(tx, links, expectedLegacyLinks(before.visitId, before.id));
    } else if (after.visitId) {
      const links = await readPhotoLinks(tx, before.id);
      if (!links.some(link => link.albumId === after.visitId))
        throw new AlbumMembershipConflict(before.id, 'undo-legacy-membership-changed');
    }
    store.put(photoSchema.parse({ ...before, visitId: null }));
    return;
  }
  if (entry.kind === 'visit') {
    const before = visitSchema.parse(entry.before), after = visitSchema.parse(entry.after);
    if (before.id !== after.id || before.tripId !== after.tripId) throw new AlbumMembershipConflict(null, 'legacy-history-invalid');
    const current: Visit | undefined = await request(store.get(entry.targetId));
    if (!sameRecord(current, after)) throw new AlbumMembershipConflict(null, 'undo-album-changed');
    if (before.representativePhotoId) {
      const representative: Photo | undefined = await request(tx.objectStore('photos').get(before.representativePhotoId));
      if (!representative || representative.tripId !== before.tripId)
        throw new AlbumMembershipConflict(null, 'undo-representative-photo-invalid');
    }
    store.put(before);
    return;
  }
  const before = tripSchema.parse(entry.before), after = tripSchema.parse(entry.after);
  if (before.id !== after.id) throw new AlbumMembershipConflict(null, 'legacy-history-invalid');
  const current: Trip | undefined = await request(store.get(entry.targetId));
  if (!sameRecord(current, after)) throw new AlbumMembershipConflict(null, 'undo-trip-changed');
  store.put(before);
};

export class LibraryDb {
  private constructor(private readonly db: IDBDatabase) {}
  static async open(name = 'photo-route-library', options: { onBlocked?: () => void; onVersionChange?: () => void } = {}): Promise<LibraryDb> {
    const opened = indexedDB.open(name, DB_VERSION);
    let upgradeError: Error | undefined;
    opened.onupgradeneeded = event => {
      const db = opened.result;
      const tx = opened.transaction!;
      if (event.oldVersion < 1) {
        db.createObjectStore('trips', { keyPath: 'id' });
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('byHash', 'contentSha256');
        photos.createIndex('byTrip', 'tripId');
        db.createObjectStore('visits', { keyPath: 'id' }).createIndex('byTrip', 'tripId');
        db.createObjectStore('thumbnails', { keyPath: 'id' });
        db.createObjectStore('jobs', { keyPath: 'id' });
      }
      if (event.oldVersion < 2) db.createObjectStore('recovery', { keyPath: 'sequence', autoIncrement: true });
      if (event.oldVersion < 3) {
        const links = db.createObjectStore('photoAlbumLinks', { keyPath: ['albumId', 'photoId'] });
        links.createIndex('byPhoto', 'photoId');
        const fail = (reason: string) => {
          upgradeError = new Error(`IndexedDB v3への移行を中止しました: ${reason}`);
          try { tx.abort(); } catch { /* A failed request may already have aborted it. */ }
        };
        // Keep all work in IndexedDB request callbacks so the versionchange transaction stays active.
        tx.objectStore('trips').getAll().onsuccess = tripEvent => {
          try {
            const trips = (tripEvent.target as IDBRequest<Trip[]>).result;
            const tripIds = new Set(trips.map(trip => tripSchema.parse(trip).id));
            tx.objectStore('visits').getAll().onsuccess = visitEvent => {
              try {
                const visits = (visitEvent.target as IDBRequest<Visit[]>).result;
                const visitById = new Map(visits.map(visit => {
                  const valid = visitSchema.parse(visit);
                  if (!tripIds.has(valid.tripId)) throw new Error('旅行が存在しないアルバムがあります');
                  return [valid.id, valid] as const;
                }));
                const photos = tx.objectStore('photos');
                const cursorRequest = photos.openCursor();
                cursorRequest.onsuccess = () => {
                  try {
                    const cursor = cursorRequest.result;
                    if (!cursor) {
                      // A representative photo need not be linked, but must belong to the album's Trip.
                      const representatives = visits.filter(visit => visit.representativePhotoId);
                      const checkRepresentative = (index: number) => {
                        if (index === representatives.length) return;
                        const visit = representatives[index]!;
                        photos.get(visit.representativePhotoId!).onsuccess = photoEvent => {
                          try {
                            const photo = (photoEvent.target as IDBRequest<Photo | undefined>).result;
                            if (!photo || photo.tripId !== visit.tripId) throw new Error('代表写真の参照が不正です');
                            checkRepresentative(index + 1);
                          } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
                        };
                      };
                      checkRepresentative(0);
                      return;
                    }
                    const photo = photoSchema.parse(cursor.value);
                    if (photo.tripId !== null && !tripIds.has(photo.tripId)) throw new Error('旅行が存在しない写真があります');
                    if (photo.visitId !== null) {
                      const album = visitById.get(photo.visitId);
                      if (!album || photo.tripId !== album.tripId) throw new Error('写真のアルバム参照または旅行が不正です');
                      links.add(photoAlbumLinkSchema.parse({ albumId: album.id, photoId: photo.id, createdAt: null }));
                      cursor.update(photoSchema.parse({ ...photo, visitId: null }));
                    }
                    cursor.continue();
                  } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
                };
              } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
            };
          } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
        };
      }
    };
    opened.onblocked = () => options.onBlocked?.();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(upgradeError ?? opened.error ?? new Error('IndexedDBを開けません'));
    });
    db.onversionchange = () => { db.close(); options.onVersionChange?.(); };
    return new LibraryDb(db);
  }
  close(): void { this.db.close(); }
  async listTrips(): Promise<Trip[]> { return request(this.db.transaction('trips').objectStore('trips').getAll()); }
  async listPhotos(): Promise<Photo[]> { return request(this.db.transaction('photos').objectStore('photos').getAll()); }
  async listPhotoAlbumLinks(photoId?: string): Promise<PhotoAlbumLink[]> {
    const store = this.db.transaction('photoAlbumLinks').objectStore('photoAlbumLinks');
    return request(photoId ? store.index('byPhoto').getAll(photoId) : store.getAll());
  }
  async albumIdsForPhoto(photoId: string): Promise<string[]> {
    tripSchema.shape.id.parse(photoId);
    return linkIds(await this.listPhotoAlbumLinks(photoId));
  }
  async photoIdsForAlbum(albumId: string): Promise<string[]> {
    tripSchema.shape.id.parse(albumId);
    const store = this.db.transaction('photoAlbumLinks').objectStore('photoAlbumLinks');
    const links: PhotoAlbumLink[] = await request(store.getAll(IDBKeyRange.bound([albumId], [albumId, []])));
    return sortedIds(links.map(link => link.photoId));
  }
  async albumIdsForPhotos(photoIds: string[]): Promise<Record<string, string[]>> {
    const wanted = new Set(photoIds);
    photoIds.forEach(id => tripSchema.shape.id.parse(id));
    const result: Record<string, string[]> = Object.fromEntries([...wanted].map(id => [id, []]));
    for (const link of await this.listPhotoAlbumLinks()) if (wanted.has(link.photoId)) result[link.photoId]!.push(link.albumId);
    for (const ids of Object.values(result)) ids.sort((a, b) => a.localeCompare(b));
    return result;
  }
  async photoIdsForAlbums(albumIds: string[]): Promise<Record<string, string[]>> {
    const wanted = new Set(albumIds);
    albumIds.forEach(id => tripSchema.shape.id.parse(id));
    const result: Record<string, string[]> = Object.fromEntries([...wanted].map(id => [id, []]));
    for (const link of await this.listPhotoAlbumLinks()) if (wanted.has(link.albumId)) result[link.albumId]!.push(link.photoId);
    for (const ids of Object.values(result)) ids.sort((a, b) => a.localeCompare(b));
    return result;
  }
  async listVisits(): Promise<Visit[]> { return request(this.db.transaction('visits').objectStore('visits').getAll()); }
  async listThumbnails(): Promise<Thumbnail[]> { return request(this.db.transaction('thumbnails').objectStore('thumbnails').getAll()); }
  async listRecovery(): Promise<RecoveryEntry[]> { return request(this.db.transaction('recovery').objectStore('recovery').getAll()); }
  async latestUndoable(): Promise<RecoveryEntry | undefined> {
    return newestUndoable(this.db.transaction('recovery').objectStore('recovery'));
  }
  async getThumbnail(id: string): Promise<Thumbnail | undefined> { return request(this.db.transaction('thumbnails').objectStore('thumbnails').get(id)); }
  async findByHash(hash: string): Promise<Photo[]> { return request(this.db.transaction('photos').objectStore('photos').index('byHash').getAll(hash)); }
  async getTrip(id: string): Promise<Trip | undefined> { return request(this.db.transaction('trips').objectStore('trips').get(id)); }
  async createTrip(input: Trip): Promise<void> {
    const trip = tripSchema.parse(input);
    const tx = this.db.transaction('trips', 'readwrite'); const done = complete(tx);
    tx.objectStore('trips').add(trip);
    await done;
  }
  async createVisit(input: Visit, photoIds: string[] = []): Promise<void> {
    if (photoIds.length) throw new Error(B1_MEMBERSHIP_GUARD);
    const visit = visitSchema.parse(input);
    const tx = this.db.transaction(['trips', 'visits', 'photos'], 'readwrite'); const done = complete(tx);
    try {
      const trip: Trip | undefined = await request(tx.objectStore('trips').get(visit.tripId));
      if (!trip || trip.deletedAt) throw new Error('Trip not found');
      const linked: Photo[] = [];
      for (const id of new Set([...photoIds, ...(visit.representativePhotoId ? [visit.representativePhotoId] : [])])) {
        const photo: Photo | undefined = await request(tx.objectStore('photos').get(id));
        if (!photo || photo.deletedAt || photo.tripId !== visit.tripId) throw new Error('invalid representative Photo');
        if (photoIds.includes(id)) {
          if (photo.visitId) throw new Error('写真は別のアルバムに所属しています。先に解除してください');
          linked.push(photo);
        }
      }
      tx.objectStore('visits').add(visit);
      for (const photo of linked) tx.objectStore('photos').put(photoSchema.parse({ ...photo, visitId: visit.id, updatedAt: visit.createdAt }));
    } catch (error) { tx.abort(); await done.catch(() => undefined); throw error; }
    await done;
  }
  async updateVisit(input: Visit, expected?: Visit): Promise<void> {
    const visit = visitSchema.parse(input);
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'recovery'], 'readwrite'); const done = complete(tx);
    try {
      const previous: Visit | undefined = await request(tx.objectStore('visits').get(visit.id));
      if (!previous || previous.tripId !== visit.tripId || previous.deletedAt) throw new Error('アルバムを更新できません');
      if (expected && !sameRecord(previous, expected)) throw new EditConflict();
      if (visit.deletedAt) throw new Error('アルバムの削除は現在利用できません');
      const trip: Trip | undefined = await request(tx.objectStore('trips').get(visit.tripId));
      if (!trip || trip.deletedAt) throw new Error('Trip not found');
      if (visit.representativePhotoId) {
        const photo: Photo | undefined = await request(tx.objectStore('photos').get(visit.representativePhotoId));
        if (!photo || photo.tripId !== visit.tripId) throw new Error('invalid representative Photo');
      }
      tx.objectStore('visits').put(visit);
      this.recordRecovery(tx, 'visit', 'アルバム編集', previous, visit);
    } catch (error) { tx.abort(); await done.catch(() => undefined); throw error; }
    await done;
  }
  async setPhotoVisit(photoId: string, visitId: string | null): Promise<void> {
    if (this.db.version >= 3) throw new Error(B1_MEMBERSHIP_GUARD);
    const tx = this.db.transaction(['photos', 'visits', 'recovery'], 'readwrite'); const done = complete(tx);
    try {
      const previous: Photo | undefined = await request(tx.objectStore('photos').get(photoId));
      if (!previous || previous.deletedAt) throw new Error('写真が見つかりません');
      if (visitId) {
        const visit: Visit | undefined = await request(tx.objectStore('visits').get(visitId));
        if (!visit || visit.deletedAt || previous.tripId !== visit.tripId) throw new Error('同じ旅行のアルバムを選んでください');
        if (previous.visitId && previous.visitId !== visitId) throw new Error('写真は別のアルバムに所属しています。先に解除してください');
      }
      if (previous.visitId !== visitId) {
        const updated = photoSchema.parse({ ...previous, visitId, updatedAt: new Date().toISOString() });
        tx.objectStore('photos').put(updated);
        this.recordRecovery(tx, 'photo', '写真のアルバム所属変更', previous, updated);
      }
    } catch (error) { tx.abort(); await done.catch(() => undefined); throw error; }
    await done;
  }
  async savePhotoVisitBatch(input: PhotoVisitBatchRequest): Promise<PhotoVisitBatchResult> {
    if (this.db.version >= 3) throw new Error(B1_MEMBERSHIP_GUARD);
    tripSchema.shape.id.parse(input.operationId);
    tripSchema.parse(input.expectedTrip);
    visitSchema.parse(input.expectedTargetVisit);
    if (input.expectedTargetVisit.tripId !== input.expectedTrip.id) throw new PhotoVisitBatchConflict(null, 'trip-mismatch');
    const seen = new Set<string>();
    for (const change of input.changes) {
      photoSchema.parse(change.before);
      if (seen.has(change.before.id)) throw new PhotoVisitBatchConflict(change.before.id, 'duplicate-photo-id');
      seen.add(change.before.id);
      if (change.expectedSourceVisit) visitSchema.parse(change.expectedSourceVisit);
      if (change.before.tripId !== input.expectedTrip.id) throw new PhotoVisitBatchConflict(change.before.id, 'trip-mismatch');
      const from = change.before.visitId, to = change.nextVisitId;
      if (to !== null && to !== input.expectedTargetVisit.id) throw new PhotoVisitBatchConflict(change.before.id, 'invalid-destination');
      if (to === null && from !== input.expectedTargetVisit.id && from !== null) throw new PhotoVisitBatchConflict(change.before.id, 'invalid-removal');
      if (from && from !== input.expectedTargetVisit.id) {
        if (!change.expectedSourceVisit || change.expectedSourceVisit.id !== from || change.expectedSourceVisit.tripId !== input.expectedTrip.id) throw new PhotoVisitBatchConflict(change.before.id, 'source-visit-required');
      } else if (change.expectedSourceVisit) throw new PhotoVisitBatchConflict(change.before.id, 'unexpected-source-visit');
    }
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'recovery'], 'readwrite');
    const done = complete(tx);
    const changed: BatchRecoveryEntry['changes'] = [];
    const updatedAt = new Date().toISOString();
    let added = 0, removed = 0, transferred = 0;
    try {
      const trip: Trip | undefined = await request(tx.objectStore('trips').get(input.expectedTrip.id));
      if (!trip || trip.deletedAt || !sameRecord(trip, input.expectedTrip)) throw new PhotoVisitBatchConflict(null, 'trip-changed');
      const target: Visit | undefined = await request(tx.objectStore('visits').get(input.expectedTargetVisit.id));
      if (!target || target.deletedAt || target.tripId !== trip.id || !sameRecord(target, input.expectedTargetVisit)) throw new PhotoVisitBatchConflict(null, 'target-visit-changed');
      if (await recoveryById(tx.objectStore('recovery'), input.operationId)) throw new PhotoVisitBatchConflict(null, 'operation-id-used');
      const sourceVisits = new Map<string, Visit>();
      for (const change of input.changes) {
        const before = change.before;
        const current: Photo | undefined = await request(tx.objectStore('photos').get(before.id));
        if (!current) throw new PhotoVisitBatchConflict(before.id, 'photo-missing');
        if (current.deletedAt || before.deletedAt) throw new PhotoVisitBatchConflict(before.id, 'photo-in-trash');
        if (!sameRecord(current, before)) throw new PhotoVisitBatchConflict(before.id, 'photo-changed');
        if (before.visitId && before.visitId !== target.id) {
          let source = sourceVisits.get(before.visitId);
          if (!source) {
            source = await request<Visit | undefined>(tx.objectStore('visits').get(before.visitId));
            if (!source) throw new PhotoVisitBatchConflict(before.id, 'source-visit-missing');
            sourceVisits.set(before.visitId, source);
          }
          if (source.tripId !== trip.id || !sameRecord(source, change.expectedSourceVisit)) throw new PhotoVisitBatchConflict(before.id, 'source-visit-changed');
        }
        if (before.visitId === change.nextVisitId) continue;
        const after = photoSchema.parse({ ...current, visitId: change.nextVisitId, updatedAt });
        tx.objectStore('photos').put(after);
        changed.push({ before: current, afterVisitId: after.visitId, afterUpdatedAt: after.updatedAt });
        if (before.visitId === null) added++;
        else if (change.nextVisitId === null) removed++;
        else transferred++;
      }
      if (changed.length) {
        const entry: BatchRecoveryEntry = { id: input.operationId, kind: 'photo-visit-batch', action: '写真のアルバム所属を一括変更', targetId: target.id, createdAt: updatedAt, changes: changed, undoneAt: null };
        tx.objectStore('recovery').add(entry);
      }
    } catch (error) { try { tx.abort(); } catch { /* An IndexedDB request may already have aborted the transaction. */ } await done.catch(() => undefined); throw error; }
    await done;
    return { status: changed.length ? 'saved' : 'no-change', operationId: input.operationId, changed: changed.length, added, removed, transferred };
  }
  async photoVisitBatchStatus(operationId: string): Promise<'absent' | 'applied' | 'undone' | 'changed-after-save'> {
    if (this.db.version >= 3) throw new Error(B1_MEMBERSHIP_GUARD);
    tripSchema.shape.id.parse(operationId);
    const tx = this.db.transaction(['recovery', 'photos']);
    const entry = await recoveryById(tx.objectStore('recovery'), operationId);
    if (!entry || entry.kind !== 'photo-visit-batch') return 'absent';
    if (entry.undoneAt) return 'undone';
    for (const change of entry.changes) {
      const current: Photo | undefined = await request(tx.objectStore('photos').get(change.before.id));
      if (!sameRecord(current, { ...change.before, visitId: change.afterVisitId, updatedAt: change.afterUpdatedAt })) return 'changed-after-save';
    }
    return 'applied';
  }
  async saveAlbumMembershipBatch(input: AlbumMembershipBatchRequest): Promise<AlbumMembershipBatchResult> {
    tripSchema.shape.id.parse(input.operationId);
    tripSchema.parse(input.expectedTrip);
    const albumById = new Map<string, Visit>();
    for (const album of input.expectedAlbums) {
      visitSchema.parse(album);
      if (albumById.has(album.id)) throw new AlbumMembershipConflict(null, 'duplicate-album-id');
      albumById.set(album.id, album);
      if (album.tripId !== input.expectedTrip.id) throw new AlbumMembershipConflict(null, 'trip-mismatch');
    }
    const photoIds = new Set<string>(), requiredAlbums = new Set<string>();
    for (const change of input.changes) {
      photoSchema.parse(change.beforePhoto);
      const photoId = change.beforePhoto.id;
      if (photoIds.has(photoId)) throw new AlbumMembershipConflict(photoId, 'duplicate-photo-id');
      photoIds.add(photoId);
      if (change.beforePhoto.tripId !== input.expectedTrip.id || change.beforePhoto.visitId !== null)
        throw new AlbumMembershipConflict(photoId, 'trip-or-legacy-membership');
      const beforeIds = new Set<string>();
      for (const link of change.expectedLinks) {
        photoAlbumLinkSchema.parse(link);
        if (link.photoId !== photoId || beforeIds.has(link.albumId)) throw new AlbumMembershipConflict(photoId, 'invalid-expected-links');
        beforeIds.add(link.albumId); requiredAlbums.add(link.albumId);
      }
      const afterIds = new Set<string>();
      for (const albumId of change.afterAlbumIds) {
        tripSchema.shape.id.parse(albumId);
        if (afterIds.has(albumId)) throw new AlbumMembershipConflict(photoId, 'duplicate-album-id');
        afterIds.add(albumId); requiredAlbums.add(albumId);
      }
    }
    if (!sameRecord(sortedIds([...albumById.keys()]), sortedIds([...requiredAlbums])))
      throw new AlbumMembershipConflict(null, 'expected-albums-incomplete');
    // Hash the complete request before opening IndexedDB; no non-IDB await occurs in the transaction.
    const hash = await requestHash(input);
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'photoAlbumLinks', 'recovery'], 'readwrite');
    const done = complete(tx);
    const changes: AlbumMembershipRecoveryEntry['changes'] = [];
    const now = new Date().toISOString();
    let added = 0, removed = 0;
    try {
      const existing = await recoveryById(tx.objectStore('recovery'), input.operationId);
      if (existing) {
        if (existing.kind !== 'photo-album-batch' || existing.requestHash !== hash)
          throw new AlbumMembershipConflict(null, 'operation-id-reused');
        if (existing.undoneAt || !(await albumEntryApplied(tx, existing)))
          throw new AlbumMembershipConflict(null, 'operation-changed-after-save');
        return { status: 'already-applied', operationId: input.operationId, changedPhotos: existing.changes.length,
          added: existing.changes.reduce((count, change) => count + change.afterLinks.filter(link => !change.beforeLinks.some(before => before.albumId === link.albumId)).length, 0),
          removed: existing.changes.reduce((count, change) => count + change.beforeLinks.filter(link => !change.afterLinks.some(after => after.albumId === link.albumId)).length, 0) };
      }
      const trip: Trip | undefined = await request(tx.objectStore('trips').get(input.expectedTrip.id));
      if (!trip || trip.deletedAt || !sameRecord(trip, input.expectedTrip)) throw new AlbumMembershipConflict(null, 'trip-changed');
      for (const [albumId, expected] of albumById) {
        const album: Visit | undefined = await request(tx.objectStore('visits').get(albumId));
        if (!album || album.tripId !== trip.id || !sameRecord(album, expected)) throw new AlbumMembershipConflict(null, 'album-changed');
      }
      for (const change of input.changes) {
        const before = change.beforePhoto, photoId = before.id;
        const current: Photo | undefined = await request(tx.objectStore('photos').get(photoId));
        if (!current || current.deletedAt || before.deletedAt || !sameRecord(current, before))
          throw new AlbumMembershipConflict(photoId, 'photo-changed');
        const currentLinks = await readPhotoLinks(tx, photoId);
        if (!sameRecord(currentLinks, sortedLinks(change.expectedLinks)))
          throw new AlbumMembershipConflict(photoId, 'membership-changed');
        const beforeIds = new Set(linkIds(currentLinks));
        const nextIds = new Set(change.afterAlbumIds);
        for (const id of nextIds) if (!beforeIds.has(id) && albumById.get(id)?.deletedAt)
          throw new AlbumMembershipConflict(photoId, 'album-in-trash');
        if (sameRecord(sortedIds([...beforeIds]), sortedIds([...nextIds]))) continue;
        const afterLinks = sortedLinks([
          ...currentLinks.filter(link => nextIds.has(link.albumId)),
          ...[...nextIds].filter(id => !beforeIds.has(id)).map(id => photoAlbumLinkSchema.parse({ albumId: id, photoId, createdAt: now })),
        ]);
        changes.push({ beforePhoto: current, beforeLinks: currentLinks, afterLinks });
        for (const link of currentLinks) if (!nextIds.has(link.albumId)) { tx.objectStore('photoAlbumLinks').delete([link.albumId, photoId]); removed++; }
        for (const link of afterLinks) if (!beforeIds.has(link.albumId)) { tx.objectStore('photoAlbumLinks').add(link); added++; }
      }
      if (changes.length) {
        const entry: AlbumMembershipRecoveryEntry = { id: input.operationId, kind: 'photo-album-batch', action: '写真のアルバム所属を一括変更',
          targetId: trip.id, createdAt: now, requestHash: hash, expectedTrip: trip, expectedAlbums: [...albumById.values()], changes, undoneAt: null };
        tx.objectStore('recovery').add(entry);
      }
    } catch (error) { try { tx.abort(); } catch { /* A failed request may already have aborted the transaction. */ } await done.catch(() => undefined); throw error; }
    await done;
    return { status: changes.length ? 'saved' : 'no-change', operationId: input.operationId, changedPhotos: changes.length, added, removed };
  }
  async albumMembershipOperationStatus(operationId: string): Promise<AlbumMembershipOperationStatus> {
    tripSchema.shape.id.parse(operationId);
    try {
      const tx = this.db.transaction(['recovery', 'photos', 'photoAlbumLinks']);
      const entry = await recoveryById(tx.objectStore('recovery'), operationId);
      if (!entry) return 'absent';
      if (entry.kind !== 'photo-album-batch') return 'unknown';
      if (entry.undoneAt) return 'undone';
      return await albumEntryApplied(tx, entry) ? 'applied' : 'changed-after-save';
    } catch { return 'unknown'; }
  }
  async updatePhotoCorrection(photoId: string, change: { gpsCorrection: Photo['gpsCorrection'] } | { timeCorrection: Photo['timeCorrection'] }, expected?: { gpsCorrection: Photo['gpsCorrection'] } | { timeCorrection: Photo['timeCorrection'] }): Promise<void> {
    const tx = this.db.transaction(['photos', 'recovery'], 'readwrite'); const done = complete(tx);
    try {
      const before: Photo | undefined = await request(tx.objectStore('photos').get(photoId));
      if (!before || before.deletedAt) throw new Error('写真が見つかりません');
      if (expected && ('gpsCorrection' in change
        ? !('gpsCorrection' in expected) || !sameRecord(before.gpsCorrection, expected.gpsCorrection)
        : !('timeCorrection' in expected) || !sameRecord(before.timeCorrection, expected.timeCorrection))) throw new EditConflict();
      const after = photoSchema.parse({ ...before, ...change, updatedAt: new Date().toISOString() });
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        tx.objectStore('photos').put(after);
        this.recordRecovery(tx, 'photo', '写真の手動補正', before, after);
      }
    } catch (error) { tx.abort(); await done.catch(() => undefined); throw error; }
    await done;
  }
  private recordRecovery(tx: IDBTransaction, kind: RecoveryKind, action: string, before: Trip | Visit | Photo, after: Trip | Visit | Photo): string {
    const entry: LegacyRecoveryEntry = { id: crypto.randomUUID(), kind, action, targetId: before.id, createdAt: new Date().toISOString(), before, after, undoneAt: null };
    tx.objectStore('recovery').add(entry);
    return entry.id;
  }
  async moveToTrash(kind: RecoveryKind, id: string): Promise<string> {
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'recovery'], 'readwrite'); const done = complete(tx);
    let recoveryId: string;
    try {
      const store = tx.objectStore(kind === 'trip' ? 'trips' : kind === 'visit' ? 'visits' : 'photos');
      const before: Trip | Visit | Photo | undefined = await request(store.get(id));
      if (!before || before.deletedAt) throw new Error('対象が見つからないか、ごみ箱にあります');
      const after = { ...before, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      store.put(after);
      recoveryId = this.recordRecovery(tx, kind, `${kind}をごみ箱へ移動`, before, after);
    } catch (error) { tx.abort(); await done.catch(() => undefined); throw error; }
    await done;
    return recoveryId;
  }
  async restoreFromTrash(kind: RecoveryKind, id: string): Promise<void> {
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'recovery'], 'readwrite'); const done = complete(tx);
    try {
      const store = tx.objectStore(kind === 'trip' ? 'trips' : kind === 'visit' ? 'visits' : 'photos');
      const before: Trip | Visit | Photo | undefined = await request(store.get(id));
      if (!before?.deletedAt) throw new Error('ごみ箱の対象が見つかりません');
      if (kind !== 'trip') {
        const tripId = (before as Visit | Photo).tripId;
        const trip: Trip | undefined = tripId ? await request(tx.objectStore('trips').get(tripId)) : undefined;
        if (tripId && (!trip || trip.deletedAt)) throw new Error('先に旅行を復元してください');
      }
      const after = { ...before, deletedAt: null, updatedAt: new Date().toISOString() };
      store.put(after);
      this.recordRecovery(tx, kind, `${kind}をごみ箱から復元`, before, after);
    } catch (error) { tx.abort(); await done.catch(() => undefined); throw error; }
    await done;
  }
  async undoLatest(expectedId?: string): Promise<RecoveryEntry> {
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'photoAlbumLinks', 'recovery'], 'readwrite');
    const done = complete(tx);
    let selected: RecoveryEntry;
    try {
      const entry = await newestUndoable(tx.objectStore('recovery'));
      if (!entry) throw new Error('元に戻せる操作がありません');
      if (expectedId !== undefined && entry.id !== expectedId) throw new Error('別の操作が行われたため、この通知からは元に戻せません');
      if (entry.kind === 'photo-album-batch') await undoAlbumBatch(tx, entry);
      else if (entry.kind === 'photo-visit-batch') await undoLegacyBatch(tx, entry);
      else if (entry.kind === 'trip' || entry.kind === 'visit' || entry.kind === 'photo') await undoLegacyEntry(tx, entry);
      else throw new Error('この操作履歴は安全にUndoできません');
      tx.objectStore('recovery').put({ ...entry, undoneAt: new Date().toISOString() });
      selected = entry;
    } catch (error) { try { tx.abort(); } catch { /* A failed request may already have aborted the transaction. */ } await done.catch(() => undefined); throw error; }
    await done;
    return selected;
  }
  async savePhoto(input: Photo, thumbnail: Thumbnail | null, options: { allowDuplicateAcrossTrips?: boolean } = {}): Promise<void> {
    const photo = photoSchema.parse(input);
    if (photo.visitId !== null) throw new Error(B1_MEMBERSHIP_GUARD);
    if (thumbnail) {
      const { blob, ...meta } = thumbnail;
      thumbnailMetaSchema.parse(meta);
      if (blob.size !== thumbnail.byteLength || blob.type !== thumbnail.mime) throw new Error('thumbnail Blob mismatch');
    }
    validateRelations(photo.tripId === null ? [] : [{ id: photo.tripId, name: 'reference', createdAt: photo.importedAt, updatedAt: photo.importedAt, deletedAt: null }], [], [{ ...photo, visitId: null }], thumbnail ? [thumbnail] : []);
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'thumbnails'], 'readwrite');
    const done = complete(tx);
    try {
      if (photo.tripId) {
        const trip: Trip | undefined = await request(tx.objectStore('trips').get(photo.tripId));
        if (!trip || trip.deletedAt) throw new Error('Trip not found');
      }
      const sameBytes: Photo[] = await request(tx.objectStore('photos').index('byHash').getAll(photo.contentSha256));
      if (sameBytes.length && !(options.allowDuplicateAcrossTrips && photo.tripId !== null && sameBytes.every(other => other.tripId !== photo.tripId))) throw new Error('元画像のSHA-256が既存写真と一致します');
      if (photo.visitId) {
        const visit: Visit | undefined = await request(tx.objectStore('visits').get(photo.visitId));
        if (!visit || visit.tripId !== photo.tripId) throw new Error('cross-trip Visit');
      }
      tx.objectStore('photos').add(photo);
      if (thumbnail) tx.objectStore('thumbnails').add(thumbnail);
    } catch (error) { tx.abort(); await done.catch(() => undefined); throw error; }
    await done;
  }
  async saveJob(job: ImportJob): Promise<void> {
    const tx = this.db.transaction('jobs', 'readwrite'); const done = complete(tx);
    tx.objectStore('jobs').put(job); await done;
  }
  async listJobs(): Promise<ImportJob[]> { return request(this.db.transaction('jobs').objectStore('jobs').getAll()); }
  async backupCounts(): Promise<{ trips: number; visits: number; photos: number; thumbnails: number; links: number }> {
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'thumbnails', 'photoAlbumLinks']);
    const [trips, visits, photos, thumbnails, links] = await Promise.all(
      ['trips', 'visits', 'photos', 'thumbnails', 'photoAlbumLinks'].map(name => request(tx.objectStore(name).count())),
    );
    return { trips: trips!, visits: visits!, photos: photos!, thumbnails: thumbnails!, links: links! };
  }
  async markInterruptedJobs(): Promise<void> {
    const jobs = (await this.listJobs()).filter(x => x.state === 'running');
    for (const job of jobs) await this.saveJob({ ...job, state: 'interrupted', lastError: '前回の取り込みは中断されました' });
  }
  async snapshot(): Promise<Snapshot> {
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'thumbnails', 'photoAlbumLinks']);
    const [trips, visits, photos, thumbnails, links] = await Promise.all([
      request<Trip[]>(tx.objectStore('trips').getAll()), request<Visit[]>(tx.objectStore('visits').getAll()),
      request<Photo[]>(tx.objectStore('photos').getAll()), request<Thumbnail[]>(tx.objectStore('thumbnails').getAll()),
      request<PhotoAlbumLink[]>(tx.objectStore('photoAlbumLinks').getAll()),
    ]);
    return { trips, visits, photos, thumbnails, links };
  }
  async restoreNew(snapshot: RestoreSeed, signal?: AbortSignal): Promise<void> {
    if (snapshot.photos.some(photo => photo.visitId !== null)) throw new Error(B1_MEMBERSHIP_GUARD);
    if ((snapshot.links?.length ?? 0) > 150000) throw new Error('アルバム所属件数の暫定上限を超えています');
    if (signal?.aborted) throw new DOMException('復元を中断しました', 'AbortError');
    for (const trip of snapshot.trips) tripSchema.parse(trip);
    for (const visit of snapshot.visits) visitSchema.parse(visit);
    for (const photo of snapshot.photos) photoSchema.parse(photo);
    for (const thumbnail of snapshot.thumbnails) {
      const { blob, ...meta } = thumbnail;
      thumbnailMetaSchema.parse(meta);
      if (blob.size !== thumbnail.byteLength || blob.type !== thumbnail.mime) throw new Error('thumbnail Blob mismatch');
    }
    validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
    validateAlbumLinks(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.links ?? []);
    const tx = this.db.transaction(['trips', 'visits', 'photos', 'thumbnails', 'photoAlbumLinks'], 'readwrite'); const done = complete(tx);
    const abortTransaction = () => { try { tx.abort(); } catch { /* The transaction may already be complete. */ } };
    signal?.addEventListener('abort', abortTransaction, { once: true });
    try {
      for (const trip of snapshot.trips) { if (signal?.aborted) throw new DOMException('復元を中断しました', 'AbortError'); if (await request(tx.objectStore('trips').get(trip.id))) throw new Error('Trip collision'); }
      for (const photo of snapshot.photos) { if (signal?.aborted) throw new DOMException('復元を中断しました', 'AbortError'); if (await request(tx.objectStore('photos').get(photo.id))) throw new Error('Photo ID collision'); }
      for (const visit of snapshot.visits) { if (signal?.aborted) throw new DOMException('復元を中断しました', 'AbortError'); if (await request(tx.objectStore('visits').get(visit.id))) throw new Error('Visit ID collision'); }
      for (const thumb of snapshot.thumbnails) { if (signal?.aborted) throw new DOMException('復元を中断しました', 'AbortError'); if (await request(tx.objectStore('thumbnails').get(thumb.id))) throw new Error('thumbnail ID collision'); }
      for (const link of snapshot.links ?? []) { if (signal?.aborted) throw new DOMException('復元を中断しました', 'AbortError'); if (await request(tx.objectStore('photoAlbumLinks').get([link.albumId, link.photoId]))) throw new Error('album membership collision'); }
      for (const trip of snapshot.trips) tx.objectStore('trips').add(trip);
      for (const visit of snapshot.visits) tx.objectStore('visits').add(visit);
      for (const photo of snapshot.photos) tx.objectStore('photos').add(photo);
      for (const thumb of snapshot.thumbnails) tx.objectStore('thumbnails').add(thumb);
      for (const link of snapshot.links ?? []) tx.objectStore('photoAlbumLinks').add(link);
      await done;
    } catch (error) {
      abortTransaction(); await done.catch(() => undefined);
      if (signal?.aborted) throw new DOMException('復元を中断しました', 'AbortError');
      throw error;
    }
    finally { signal?.removeEventListener('abort', abortTransaction); }
  }
}
