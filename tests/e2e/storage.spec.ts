import { expect, test } from '@playwright/test';

test('P0-T06 IndexedDB reload, Blob, rollback and migration', async ({ page }) => {
  await page.goto('/');
  const databaseName = `phase0-storage-${crypto.randomUUID()}`;
  const first = await page.evaluate(async name => {
    const { openSpikeDb, saveBundle, readRecord } = await import('../../spikes/p0-t06/storage');
    const db = await openSpikeDb(name);
    const bundle = {
      trip: { id: 't1', name: 'synthetic' }, visit: { id: 'v1', tripId: 't1' },
      photo: { id: 'p1', tripId: 't1', visitId: 'v1', thumbnailId: 'th1' },
      thumbnail: { id: 'th1', photoId: 'p1', blob: new Blob(['synthetic thumbnail'], { type: 'image/webp' }) },
    };
    await saveBundle(db, bundle);
    let quota = '';
    let invalid = '';
    try { await saveBundle(db, {
      trip: { id: 't2', name: 'should rollback' }, visit: { id: 'v2', tripId: 't2' },
      photo: { id: 'p2', tripId: 't2', visitId: 'v2', thumbnailId: 'th2' },
      thumbnail: { id: 'th2', photoId: 'p2', blob: bundle.thumbnail.blob },
    }, 'quota'); } catch (error) { quota = (error as Error).name; }
    try { await saveBundle(db, { ...bundle, trip: { id: 't3', name: 'should rollback' } }, 'invalid-link'); } catch (error) { invalid = (error as Error).message; }
    const absent2 = await readRecord(db, 'trips', 't2');
    const absent3 = await readRecord(db, 'trips', 't3');
    db.close();
    return { quota, invalid, absent2, absent3 };
  }, databaseName);
  expect(first).toEqual({ quota: 'QuotaExceededError', invalid: 'invalid relationship', absent2: undefined, absent3: undefined });

  await page.reload();
  const afterReload = await page.evaluate(async name => {
    const { openSpikeDb, readRecord } = await import('../../spikes/p0-t06/storage');
    const v1 = await openSpikeDb(name);
    const thumbnail = await readRecord<{ blob: Blob }>(v1, 'thumbnails', 'th1');
    const trip = await readRecord<{ name: string }>(v1, 'trips', 't1');
    const bytes = thumbnail ? await thumbnail.blob.text() : null;
    v1.close();
    const v2 = await openSpikeDb(name, 2);
    const stores = Array.from(v2.objectStoreNames);
    const retained = await readRecord(v2, 'photos', 'p1');
    v2.close();
    const estimate = await navigator.storage.estimate();
    return { trip: trip?.name, bytes, stores, retained: Boolean(retained), estimatedUsage: estimate.usage, estimatedQuota: estimate.quota };
  }, databaseName);
  console.log(`P0-T06 ${JSON.stringify({ ...first, ...afterReload })}`);
  expect(afterReload.trip).toBe('synthetic');
  expect(afterReload.bytes).toBe('synthetic thumbnail');
  expect(afterReload.stores).toContain('schemaNotes');
  expect(afterReload.retained).toBe(true);
});
