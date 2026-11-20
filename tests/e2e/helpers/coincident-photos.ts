import { type Page } from '@playwright/test';
import { seedUi } from './ui-package';
export async function records(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const state = { photos: await db.listPhotos(), albums: await db.listVisits(), trips: await db.listTrips(), links: await db.listPhotoAlbumLinks(), history: await db.listRecovery() };
    db.close(); return state;
  });
}
export async function probe(page: Page) {
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../../src/presentation/map.ts'); const original = PhotoMap.prototype.setViewportPadding;
    PhotoMap.prototype.setViewportPadding = function (padding) { (window as unknown as { v42Map: unknown }).v42Map = (this as unknown as { map: unknown }).map; original.call(this, padding); };
    window.dispatchEvent(new Event('resize'));
  });
}
export async function camera(page: Page) {
  return page.evaluate(() => { const map = (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map; return { center: map.getCenter().toArray(), zoom: map.getZoom() }; });
}
export async function seedGroup(page: Page, count: number) {
  const ids = await seedUi(page, { mobileEditing: true });
  const group = await page.evaluate(async ({ ids, count }) => {
    const { LibraryDb } = await import('../../../src/infrastructure/storage'); const { photoSchema } = await import('../../../src/domain/model');
    const db = await LibraryDb.open(), photos = await db.listPhotos(), source = photos.find(p => p.id === ids.photos[0])!;
    const group: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const tx = (db as unknown as { db: IDBDatabase }).db.transaction(['photos', 'photoAlbumLinks'], 'readwrite');
      for (let i = 0; i < count; i++) {
        const photo = i < ids.photos.length ? photos.find(p => p.id === ids.photos[i])! : photoSchema.parse({ ...source, id: crypto.randomUUID(), thumbnailId: null, thumbnailState: 'not-attempted', contentSha256: (1000 + i).toString(16).padStart(64, '0') });
        photo.sourceGps = structuredClone(source.sourceGps); photo.originalFilename = `合成同一点-${String(i + 1).padStart(3, '0')}.jpg`;
        tx.objectStore('photos').put(photo); tx.objectStore('photoAlbumLinks').put({ albumId: ids.albums[0]!, photoId: photo.id, createdAt: null }); group.push(photo.id);
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close(); return group;
  }, { ids, count });
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip); await probe(page);
  return { ...ids, group };
}
