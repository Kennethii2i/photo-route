/** Disposable browser-only IndexedDB proof; not the product's physical schema. */
export type SyntheticBundle = {
  trip: { id: string; name: string };
  visit: { id: string; tripId: string };
  photo: { id: string; tripId: string | null; visitId: string | null; thumbnailId: string | null };
  thumbnail: { id: string; photoId: string; blob: Blob };
};

export function openSpikeDb(name: string, version: 1 | 2 = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ['trips', 'visits', 'photos', 'thumbnails']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
      if (version >= 2 && !db.objectStoreNames.contains('schemaNotes')) db.createObjectStore('schemaNotes', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('version change blocked by open connection'));
  });
}

export function saveBundle(db: IDBDatabase, bundle: SyntheticBundle, injectFailure?: 'quota' | 'invalid-link'): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['trips', 'visits', 'photos', 'thumbnails'], 'readwrite');
    let injectedError: Error | null = null;
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(injectedError ?? tx.error ?? new Error('transaction aborted'));
    tx.onerror = () => { /* onabort carries the final error */ };
    tx.objectStore('trips').put(bundle.trip);
    tx.objectStore('visits').put(bundle.visit);
    if (injectFailure === 'invalid-link' || bundle.visit.tripId !== bundle.trip.id ||
      bundle.photo.tripId !== bundle.trip.id || bundle.photo.visitId !== bundle.visit.id ||
      bundle.thumbnail.photoId !== bundle.photo.id || bundle.photo.thumbnailId !== bundle.thumbnail.id) {
      injectedError = new Error('invalid relationship');
      tx.abort();
      return;
    }
    tx.objectStore('photos').put(bundle.photo);
    tx.objectStore('thumbnails').put(bundle.thumbnail);
    if (injectFailure === 'quota') {
      injectedError = new DOMException('simulated storage quota failure', 'QuotaExceededError');
      tx.abort();
    }
  });
}

export function readRecord<T>(db: IDBDatabase, store: string, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}
