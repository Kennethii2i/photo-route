import { expect, type Page } from '@playwright/test';

export async function seedUi(page: Page, options: { mobileEditing?: boolean; searchScenario?: boolean } = {}) {
  const testPort = process.env.PHOTO_ROUTE_TEST_PORT ?? '5184';
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === testPort) return route.continue();
    // Offline style used by all UI tests; no external requests leave this browser.
    if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/styles/'))
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efeb' } }] }) });
    return route.abort();
  });
  await page.goto('/');
  const ids = await page.evaluate(async ({ mobileEditing, searchScenario }) => {
    const { LibraryDb } = await import('../../../src/infrastructure/storage');
    const { newTrip, photoSchema } = await import('../../../src/domain/model');
    const { newVisit } = await import('../../../src/domain/visits');
    const { sourceClockEvidence } = await import('../../../src/domain/time');
    const trip = newTrip('海辺の週末');
    const albums = [mobileEditing ? '海辺で見つけたお気に入りの風景と週末の散歩記録' : '港と街の散歩', '海のある風景', '週末のおいしいもの'].map((name, index) => ({ ...newVisit(trip.id, name), updatedAt: `2026-01-0${index + 2}T10:00:00.000Z` }));
    const otherTrip = searchScenario ? newTrip('別の合成旅行') : null;
    if (otherTrip) albums.push(newVisit(trip.id, '港と街の散歩'), newVisit(otherTrip.id, '別旅行のアルバム'));
    const blobs: Blob[] = [];
    for (let index = 0; index < 6; index++) {
      const portrait = mobileEditing && index === 0;
      const canvas = document.createElement('canvas'); canvas.width = portrait ? 270 : 360; canvas.height = portrait ? 360 : 270;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, 0, 270); gradient.addColorStop(0, ['#b9dce3', '#efbb9d', '#d6d9bd'][index % 3]!); gradient.addColorStop(1, '#f7ead7');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff1ba'; ctx.beginPath(); ctx.arc(portrait ? 220 : 275, 55, 24, 0, Math.PI * 2); ctx.fill();
      if (index % 3 === 0) { ctx.fillStyle = '#659d9d'; ctx.fillRect(0, 130, canvas.width, canvas.height - 130); ctx.fillStyle = '#d9c59d'; ctx.beginPath(); ctx.moveTo(0, canvas.height - 60); ctx.lineTo(canvas.width, canvas.height); ctx.lineTo(0, canvas.height); ctx.fill(); }
      if (index % 3 === 1) { for (let x = 15; x < 360; x += 58) { const h = 80 + x % 100; ctx.fillStyle = x % 2 ? '#b39176' : '#8b8f7c'; ctx.fillRect(x, 270 - h, 48, h); ctx.fillStyle = '#f4dfb8'; for (let y = 280 - h; y < 255; y += 23) ctx.fillRect(x + 10, y, 8, 12); } }
      if (index % 3 === 2) { ctx.fillStyle = '#ab835e'; ctx.fillRect(0, 170, 360, 100); ctx.fillStyle = '#faf5e5'; ctx.beginPath(); ctx.ellipse(180, 185, 110, 57, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#cc864b'; ctx.beginPath(); ctx.ellipse(180, 185, 88, 39, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#64835f'; for (let x = 115; x < 240; x += 30) ctx.fillRect(x, 178 + x % 19, 13, 9); }
      blobs.push(await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg', .88)));
    }
    const photos = Array.from({ length: 24 }, (_, index) => {
      const clock = `2026:01:0${2 + Math.floor(index / 8)} ${String(8 + index % 8).padStart(2, '0')}:20:00`;
      return photoSchema.parse({ id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: mobileEditing && index === 0 ? '海辺の朝_長いファイル名の写真_2026-01-02.jpg' : `${['海辺', '街並み', 'ランチ'][index % 3]}-${index + 1}.jpg`,
        sourceMime: 'image/jpeg', sourceByteLength: 3_000_000, contentSha256: index.toString(16).padStart(64, '0'),
        sourceGps: { rawTags: {}, normalized: index === 23 ? null : { latitude: 32.73 + (index % 6) * .001, longitude: 129.87 + Math.floor(index / 6) * .001 }, horizontalErrorMeters: null, datum: 'WGS-84', status: index === 23 ? 'missing' : 'valid', issues: [] },
        sourceTime: { ...sourceClockEvidence(clock, null), rawDateTimeOriginal: clock, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null, issues: [] },
        gpsCorrection: null, timeCorrection: null, sourceOrientation: null, thumbnailId: crypto.randomUUID(), thumbnailState: 'available', metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null });
    });
    const links = photos.flatMap((photo, index) => (mobileEditing ? index === 0 ? [0, 1] : [1 + index % 2] : [index % 3, ...(index % 4 === 0 && index % 3 !== 0 ? [0] : [])]).map(owner => ({ albumId: albums[owner]!.id, photoId: photo.id, createdAt: null })));
    if (searchScenario) {
      for (let index = links.length - 1; index >= 0; index--) if (links[index]!.photoId === photos[23]!.id) links.splice(index, 1);
      links.push({ albumId: albums[3]!.id, photoId: photos[0]!.id, createdAt: null });
    }
    const thumbnails = photos.map((photo, index) => ({ id: photo.thumbnailId!, photoId: photo.id, mime: 'image/jpeg' as const, width: mobileEditing && index % 6 === 0 ? 270 : 360, height: mobileEditing && index % 6 === 0 ? 360 : 270, byteLength: blobs[index % 6]!.size, blob: blobs[index % 6]! }));
    const db = await LibraryDb.open(); await db.restoreNew({ trips: otherTrip ? [trip, otherTrip] : [trip], visits: albums, photos, links, thumbnails }); db.close();
    return { trip: trip.id, otherTrip: otherTrip?.id, albums: albums.map(item => item.id), photos: photos.map(item => item.id) };
  }, options);
  await page.reload(); await page.locator('#trip-select').selectOption(ids.trip);
  await expect(page.locator('#photo-count')).toHaveText('写真 24枚');
  return ids;
}
