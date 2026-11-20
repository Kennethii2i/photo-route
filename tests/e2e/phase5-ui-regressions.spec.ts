import { expect, test, type Page } from '@playwright/test';

async function seedSyntheticLibrary(page: Page): Promise<{ tripId: string; otherTripId: string; photoIds: string[]; thumbnailIds: string[]; visitIds: string[] }> {
  const baseURL = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(baseURL) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema, visitSchema } = await import('../../src/domain/model');
    const db = await LibraryDb.open();
    const trip = newTrip('Synthetic Trip');
    const otherTrip = newTrip('Other Synthetic Trip');
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!;
    const image = async (color: string): Promise<Blob> => {
      context.fillStyle = color; context.fillRect(0, 0, 16, 16);
      return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG failed')), 'image/png'));
    };
    const blobs = [await image('#ef0000'), await image('#0000ef')];
    const photos = blobs.map((_, index) => photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: index ? 'B.jpg' : 'A.jpg',
      sourceMime: 'image/jpeg', sourceByteLength: 100, contentSha256: index.toString(16).padStart(64, '0'),
      sourceGps: { rawTags: {}, normalized: null, horizontalErrorMeters: null, datum: null, status: 'missing', issues: [] },
      gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
        localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, thumbnailId: crypto.randomUUID(), thumbnailState: 'available',
      metadataIssues: [], importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    const thumbnails = photos.map((photo, index) => ({
      id: photo.thumbnailId!, photoId: photo.id, mime: 'image/png' as const,
      width: 16, height: 16, byteLength: blobs[index]!.size, blob: blobs[index]!,
    }));
    const visits = ['Visit A', 'Visit B'].map(label => visitSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, label, representativeLocation: null, locationSource: 'none',
      representativePhotoId: null, userStartAtUtc: null, userEndAtUtc: null,
      createdAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    }));
    await db.restoreNew({ trips: [trip, otherTrip], visits, photos, thumbnails });
    db.close();
    return { tripId: trip.id, otherTripId: otherTrip.id, photoIds: photos.map(photo => photo.id),
      thumbnailIds: thumbnails.map(thumbnail => thumbnail.id), visitIds: visits.map(visit => visit.id) };
  });
  await page.reload();
  await page.locator('#trip-select').selectOption(ids.tripId);
  await expect(page.locator('#photo-list button')).toHaveCount(2);
  return ids;
}

test('late thumbnail results never change another or closed Photo detail', async ({ page }) => {
  const ids = await seedSyntheticLibrary(page);
  await page.evaluate(async slowId => {
    const moduleUrl = new URL('/src/infrastructure/storage.ts', location.origin).href;
    const { LibraryDb } = await import(moduleUrl) as typeof import('../../src/infrastructure/storage');
    const original = LibraryDb.prototype.getThumbnail;
    const diagnostics = window as unknown as { thumbnailCalls: Array<{ id: string; at: number }> };
    diagnostics.thumbnailCalls = [];
    LibraryDb.prototype.getThumbnail = function (id) {
      diagnostics.thumbnailCalls.push({ id, at: performance.now() });
      return new Promise((resolve, reject) => {
        window.setTimeout(() => { void original.call(this, id).then(resolve, reject); }, id === slowId ? 550 : 0);
      });
    };
  }, ids.thumbnailIds[0]);
  const first = page.locator(`#photo-list button[data-photo-id="${ids.photoIds[0]}"]`);
  const second = page.locator(`#photo-list button[data-photo-id="${ids.photoIds[1]}"]`);
  for (let index = 0; index < 8; index++) {
    await page.evaluate(async ([firstId, secondId]) => {
      document.querySelector<HTMLButtonElement>(`#photo-list button[data-photo-id="${firstId}"]`)!.click();
      await new Promise(resolve => window.setTimeout(resolve, 12));
      document.querySelector<HTMLButtonElement>(`#photo-list button[data-photo-id="${secondId}"]`)!.click();
    }, [ids.photoIds[0]!, ids.photoIds[1]!]);
    await page.waitForTimeout(620);
    if (index === 0) {
      const calls = await page.evaluate(() => (window as unknown as { thumbnailCalls: Array<{ id: string }> }).thumbnailCalls.map(call => call.id));
      expect(calls).toContain(ids.thumbnailIds[0]);
      expect(calls).toContain(ids.thumbnailIds[1]);
    }
    await expect(page.locator('#photo-list button[aria-pressed="true"]')).toHaveAttribute('data-photo-id', ids.photoIds[1]!);
    await expect(page.locator('#photo-detail h3')).toHaveText('B.jpg');
    await expect(page.locator('#photo-detail img')).toHaveCount(1);
    await expect(page.locator('#photo-detail img')).toHaveAttribute('alt', 'B.jpg のサムネイル');
  }
  for (let index = 0; index < 12; index++) await (index % 2 ? second : first).click();
  await second.click();
  await page.waitForTimeout(620);
  await expect(page.locator('#photo-detail img')).toHaveCount(1);
  await expect(page.locator('#photo-detail img')).toHaveAttribute('alt', 'B.jpg のサムネイル');
  await page.evaluate(id => document.querySelector<HTMLButtonElement>(`#photo-list button[data-photo-id="${id}"]`)!.click(), ids.photoIds[0]);
  await page.locator('#trip-select').selectOption(ids.otherTripId);
  await page.waitForTimeout(620);
  await expect(page.locator('#photo-detail')).toHaveText('一覧から写真を選んでください。');
  await expect(page.locator('#photo-detail img')).toHaveCount(0);
});

test('Visit drafts survive unrelated renders and failed saves; switching asks before discarding', async ({ page }) => {
  const ids = await seedSyntheticLibrary(page);
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.visitIds[0]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await page.locator('#visit-label').fill('Unsaved Visit A');
  await page.locator('#visit-latitude').fill('32.73');
  await page.locator('#visit-longitude').fill('129.87');
  await page.locator('#visit-start').fill('2026-11-17T09:00:00.000Z');
  await page.locator('#visit-end').fill('2026-11-17T10:00:00.000Z');
  await page.locator('#left-tab-photos').click();
  await page.locator(`#photo-list button[data-photo-id="${ids.photoIds[0]}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('A.jpg');
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-advanced > summary').click();
  await page.locator('#gps-correction-latitude').fill('32.73');
  await page.locator('#gps-correction-longitude').fill('129.87');
  await page.getByRole('button', { name: 'GPS補正を保存' }).click();
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.visitIds[0]}"]`).click();
  await expect(page.locator('#visit-label')).toHaveValue('Unsaved Visit A');
  await expect(page.locator('#visit-latitude')).toHaveValue('32.73');
  await expect(page.locator('#visit-longitude')).toHaveValue('129.87');
  await expect(page.locator('#visit-start')).toHaveValue('2026-11-17T09:00:00.000Z');
  await expect(page.locator('#visit-end')).toHaveValue('2026-11-17T10:00:00.000Z');
  const storedBeforeSave = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const visit = (await db.listVisits()).find(item => item.id === id); db.close();
    return visit?.label;
  }, ids.visitIds[0]);
  expect(storedBeforeSave).toBe('Visit A');
  await page.evaluate(async () => {
    const moduleUrl = new URL('/src/infrastructure/storage.ts', location.origin).href;
    const { LibraryDb } = await import(moduleUrl) as typeof import('../../src/infrastructure/storage');
    const original = LibraryDb.prototype.updateVisit;
    let failOnce = true;
    LibraryDb.prototype.updateVisit = function (visit) {
      if (failOnce) { failOnce = false; return Promise.reject(new Error('injected save failure')); }
      return original.call(this, visit);
    };
  });
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-status')).toContainText('injected save failure');
  await expect(page.locator('#visit-label')).toHaveValue('Unsaved Visit A');
  await expect(page.locator('#visit-latitude')).toHaveValue('32.73');
  await expect(page.locator('#visit-longitude')).toHaveValue('129.87');
  await expect(page.locator('#visit-start')).toHaveValue('2026-11-17T09:00:00.000Z');
  await expect(page.locator('#visit-end')).toHaveValue('2026-11-17T10:00:00.000Z');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-status')).toContainText('アルバムを保存しました');
  await expect(page.locator('#visit-label')).toHaveValue('Unsaved Visit A');
  const storedAfterSave = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const visit = (await db.listVisits()).find(item => item.id === id); db.close();
    return { label: visit?.label, point: visit?.representativeLocation };
  }, ids.visitIds[0]);
  expect(storedAfterSave).toEqual({ label: 'Unsaved Visit A', point: { latitude: 32.73, longitude: 129.87 } });
  await page.locator('#header-manage').click();
  await page.locator('#undo-button').click();
  await page.locator('#management-close').click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await expect(page.locator('#visit-label')).toHaveValue('Visit A');
  await page.locator('#visit-label').fill('Another unsaved edit');
  page.once('dialog', dialog => { void dialog.dismiss(); });
  await page.locator('#trip-select').selectOption(ids.otherTripId);
  await expect(page.locator('#trip-select')).toHaveValue(ids.tripId);
  await expect(page.locator('#visit-label')).toHaveValue('Another unsaved edit');
  page.once('dialog', dialog => { void dialog.dismiss(); });
  await page.locator(`#visit-list button[data-visit-id="${ids.visitIds[1]}"]`).click();
  await expect(page.locator('#visit-label')).toHaveValue('Another unsaved edit');
  await expect(page.locator(`#visit-list button[data-visit-id="${ids.visitIds[0]}"]`)).toHaveAttribute('aria-pressed', 'true');
  page.once('dialog', dialog => { void dialog.accept(); });
  await page.locator(`#visit-list button[data-visit-id="${ids.visitIds[1]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await expect(page.locator('#visit-label')).toHaveValue('Visit B');
});
