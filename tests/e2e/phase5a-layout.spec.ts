import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { localUi, createTripUi, photoListUi } from './helpers/ux-rc-flows';
test.use({ actionTimeout: 7000 });

async function openPhotoEditing(page: Page): Promise<void> {
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-advanced > summary').click();
}

async function seed(page: Page): Promise<{ tripId: string; photoId: string; visitId: string }> {
  const origin = test.info().project.use.baseURL as string;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newTrip, photoSchema, visitSchema } = await import('../../src/domain/model');
    const { newVisit } = await import('../../src/domain/visits');
    const db = await LibraryDb.open();
    const trip = newTrip('合成旅行');
    const visit = visitSchema.parse({ ...newVisit(trip.id, '合成Visit'), representativeLocation: { latitude: 32.75, longitude: 129.87 }, locationSource: 'manual' });
    const photo = photoSchema.parse({
      id: crypto.randomUUID(), tripId: trip.id, visitId: null, originalFilename: 'synthetic.jpg', sourceMime: 'image/jpeg',
      sourceByteLength: 100, contentSha256: 'a'.repeat(64),
      sourceGps: { rawTags: {}, normalized: { latitude: 32.75, longitude: 129.87 }, horizontalErrorMeters: null,
        datum: 'WGS-84', status: 'valid', issues: [] }, gpsCorrection: null,
      sourceTime: { rawDateTimeOriginal: null, rawOffsetTimeOriginal: null, rawGpsDateStamp: null, rawGpsTimeStamp: null,
        localClock: null, offsetMinutes: null, capturedAtUtc: null, status: 'missing', evidence: 'none', issues: [] },
      timeCorrection: null, sourceOrientation: null, thumbnailId: null, thumbnailState: 'failed', metadataIssues: [],
      importedAt: trip.createdAt, updatedAt: trip.createdAt, deletedAt: null,
    });
    await db.restoreNew({ trips: [trip], visits: [visit], photos: [photo], thumbnails: [],
      links: [{ albumId: visit.id, photoId: photo.id, createdAt: null }] });
    db.close();
    return { tripId: trip.id, photoId: photo.id, visitId: visit.id };
  });
  await page.reload();
  await page.locator('#trip-select').selectOption(ids.tripId);
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  return ids;
}

test('desktop map stays full viewport while independent panels, selections and management work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  await expect(page.locator('body')).toHaveAttribute('data-left-open', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-right-open', 'false');
  const bounds = await page.locator('#map').boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });
  await expect(page.locator('#map canvas')).toHaveCount(1);
  await page.locator(`#photo-list button[data-photo-id="${ids.photoId}"]`).click();
  await expect(page.locator('body')).toHaveAttribute('data-right-open', 'true');
  await expect(page.locator('#photo-detail h3')).toHaveText('synthetic.jpg');
  await page.locator('#right-close').click();
  await expect(page.locator(`#photo-list button[data-photo-id="${ids.photoId}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#left-tab-visits').click();
  await expect(page.locator('#visit-list button')).toHaveCount(1);
  await page.locator(`#visit-list button[data-visit-id="${ids.visitId}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await expect(page.locator('#visit-label')).toHaveValue('合成Visit');
  await page.locator('#left-close').click();
  await expect(page.locator('body')).toHaveAttribute('data-left-open', 'false');
  expect(await page.locator('#map').boundingBox()).toMatchObject({ width: 1440, height: 900 });
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-zoom-in').click();
  await expect(page.locator('#map-zoom-level')).toContainText('ズーム:');
  await page.screenshot({ path: test.info().outputPath('phase5a1-desktop-settings.png'), fullPage: true });
  await page.locator('#header-manage').click();
  await expect(page.locator('#trip-form')).toBeVisible();
  await expect(page.locator('#export-button')).toBeVisible();
  await expect(page.locator('#undo-button')).toBeVisible();
  await page.locator('#management-close').click();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.locator('body')).toHaveAttribute('data-left-open', 'false');
  expect(await page.locator('#map').boundingBox()).toMatchObject({ width: 900, height: 700 });
  await expect(page.locator('#visit-label')).toHaveValue('合成Visit');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#header-left').click();
  await page.locator('#left-tab-photos').click();
  await page.locator(`#photo-list button[data-photo-id="${ids.photoId}"]`).click();
  await page.locator('#map-tools > summary').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath('phase5a1-desktop.png'), fullPage: true });
});

test('mobile tabs retain map instance, selection and unsaved Visit input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ids = await seed(page);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'map');
  await expect(page.locator('#map canvas')).toHaveCount(1);
  await page.evaluate(() => { (window as Window & { mapCanvas?: Element | null }).mapCanvas = document.querySelector('#map canvas'); });
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-marker-index summary').click();
  await page.locator('#map-marker-list button[data-marker-kind="photo"]').click();
  await page.locator('#map-tools > summary').click();
  await expect(page.locator('#photo-detail h3')).toHaveText('synthetic.jpg');
  await page.locator('#right-close').click();
  await page.locator('#mobile-tab-photos').click();
  await page.locator(`#photo-list button[data-photo-id="${ids.photoId}"]`).click();
  await expect(page.locator('#photo-detail h3')).toHaveText('synthetic.jpg');
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath('phase5a1-mobile-photo.png'), fullPage: true });
  await page.locator('#mobile-tab-visits').click();
  await expect(page.locator('body')).toHaveAttribute('data-right-open', 'false');
  await page.locator(`#visit-list button[data-visit-id="${ids.visitId}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await page.locator('#visit-label').fill('未保存のVisit名');
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath('phase5a1-mobile-visit.png'), fullPage: true });
  await page.locator('#mobile-tab-map').click();
  expect(await page.evaluate(() => (window as Window & { mapCanvas?: Element | null }).mapCanvas === document.querySelector('#map canvas'))).toBe(true);
  expect(await page.locator('#map').boundingBox()).toMatchObject({ width: 390, height: 844 });
  await page.locator('#mobile-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${ids.visitId}"]`).click();
  await expect(page.locator('#visit-label')).toHaveValue('未保存のVisit名');
  await page.locator('#visit-save').scrollIntoViewIfNeeded();
  const buttonBottom = (await page.locator('#visit-save').boundingBox())!.y + (await page.locator('#visit-save').boundingBox())!.height;
  const tabsTop = (await page.locator('#mobile-tabs').boundingBox())!.y;
  expect(buttonBottom).toBeLessThan(tabsTop);
  await page.locator('#right-close').click();
  await page.locator('#mobile-tab-photos').click();
  await expect(page.locator(`#photo-list button[data-photo-id="${ids.photoId}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mobile-tab-map').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: test.info().outputPath('phase5a1-mobile.png'), fullPage: true });
  await page.locator('#header-add').click();
  await expect(page.locator('#photo-files')).toBeVisible();
  await page.locator('#management-close').click();
});

test('compact controls and header remain usable across desktop and narrow mobile widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  await expect(page.locator('#basemap-toggle')).not.toBeChecked();
  const closedTools = await page.locator('#map-tools').boundingBox();
  expect(closedTools!.width).toBeLessThan(110);
  expect((await page.locator('#map-tools > summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.locator('#map-tools > summary').click();
  await expect(page.locator('#basemap-privacy')).toBeVisible();
  await page.locator('#map-layer-custom > summary').click();
  await expect(page.locator('#photos-layer-toggle')).toBeVisible();
  await expect(page.locator('#visits-layer-toggle')).toBeVisible();
  expect((await page.locator('#photos-layer-toggle').boundingBox())!.width).toBeLessThanOrEqual(20);
  await page.locator('#map-tools > summary').click();
  for (const width of [1440, 1100, 900, 760, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    const bounds = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const trip = box('.trip-picker'), actions = box('.header-actions'), map = box('#map');
      return { tripRight: trip.right, actionsLeft: actions.left, actionsRight: actions.right, mapWidth: map.width,
        documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    expect(bounds.tripRight).toBeLessThanOrEqual(bounds.actionsLeft + 1);
    expect(bounds.actionsRight).toBeLessThanOrEqual(width);
    expect(bounds.documentWidth).toBeLessThanOrEqual(width);
    expect(bounds.mapWidth).toBe(width);
    if (width === 1100) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: test.info().outputPath('phase5a1-desktop-1100.png'), fullPage: true });
    }
    if (width === 900) {
      await page.locator('#header-left').click();
      await page.locator(`#photo-list button[data-photo-id="${ids.photoId}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-left-open', 'false');
      const tools = await page.locator('#map-tools').boundingBox();
      const detail = await page.locator('#right-panel').boundingBox();
      expect(tools!.x + tools!.width).toBeLessThan(detail!.x);
      const status = await page.locator('#map-status').boundingBox();
      expect(status!.x + status!.width).toBeLessThan(detail!.x);
      await page.waitForTimeout(250);
      await page.screenshot({ path: test.info().outputPath('phase5a1-desktop-900.png'), fullPage: true });
    }
    if (width === 760) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: test.info().outputPath('phase5a1-desktop-760.png'), fullPage: true });
    }
    if (width <= 390) {
      await expect(page.locator('#left-close')).toBeHidden();
      for (const selector of ['#mobile-tab-map', '#mobile-tab-photos', '#mobile-tab-visits', '#header-add', '#header-manage']) {
        expect((await page.locator(selector).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    if (width === 390) await page.locator('#right-close').click();
    if (width === 320) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: test.info().outputPath('phase5a1-mobile-320.png'), fullPage: true });
    }
  }
});

test('header management retains Trip, import, Visit, trash, Undo and ZIP flows', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const origin = test.info().project.use.baseURL as string;
  await localUi(page);
  await page.goto('/');
  await createTripUi(page, '合成E2E旅行');
  await expect(page.locator('#trip-select')).toHaveValue(/.+/);
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') });
  await page.locator('#import-button').click();
  await expect(page.locator('#photo-list button')).toHaveCount(1);
  await page.locator('#import-done').click(); await photoListUi(page);
  await page.locator('#photo-list button').click();
  await expect(page.locator('#photo-detail h3')).toHaveText('synthetic.jpg');
  await openPhotoEditing(page);
  await page.locator('#left-tab-visits').click();
  await page.locator('#visit-create-from-list').click();
  await page.locator('#visit-label').fill('合成訪問');
  await page.locator('#visit-save').click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await page.getByRole('checkbox', { name: 'synthetic.jpgをこのアルバムに所属させる' }).check();
  await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('1枚追加');
  await page.locator('#vpe-close').click();
  await expect(page.locator('#visit-list button')).toContainText('合成訪問');
  await page.locator('#visit-list button').click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await page.locator('#visit-delete').click();
  await expect(page.locator('#trash-confirm')).toBeVisible();
  await page.locator('#trash-commit').click();
  await expect(page.locator('#management-panel')).not.toBeVisible(); await page.locator('#header-manage').click();
  await page.locator('#trash-section > summary').click();
  await expect(page.locator('#visit-list button')).toHaveCount(0);
  await page.getByRole('button', { name: 'アルバム: 合成訪問を復元' }).click();
  await expect(page.locator('#visit-list button')).toHaveCount(1);
  await page.locator('#undo-button').click();
  await expect(page.locator('#visit-list button')).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#archive-heading').scrollIntoViewIfNeeded();
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  const archive = readFileSync(await download.path());
  const fresh = await browser.newContext();
  try {
    const target = await fresh.newPage();
    await target.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
    await target.goto('/');
    await target.locator('#header-manage').click();
    await target.locator('#archive-file').setInputFiles({ name: 'synthetic.zip', mimeType: 'application/zip', buffer: archive });
    await target.locator('#restore-button').click();
    await expect(target.locator('#archive-status')).toContainText('1件の旅行と1件の写真を復元');
    await target.locator('#trip-select').selectOption({ label: '合成E2E旅行' });
    await expect(target.locator('#photo-list button')).toHaveCount(1);
  } finally { await fresh.close(); }
});

test('map click opens Visit editing without changing the Photo source record', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  const before = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const photo = (await db.listPhotos()).find(item => item.id === id); db.close(); return photo;
  }, ids.photoId);
  await page.locator('#map-tools > summary').click();
  await page.locator('#visit-map-create').click();
  await page.locator('#map').click({ position: { x: 800, y: 350 } });
  await expect(page.locator('body')).toHaveAttribute('data-right-open', 'true');
  await expect(page.locator('#visit-latitude')).not.toBeEmpty();
  await page.locator('#visit-label').fill('地図からの合成訪問');
  await page.locator('#visit-save').click();
  await expect(page.locator('#visit-list button')).toHaveCount(2);
  const after = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open(); const photo = (await db.listPhotos()).find(item => item.id === id); db.close(); return photo;
  }, ids.photoId);
  expect(after).toEqual(before);
});

test('coincident Visit markers remain selectable beside the Photo layer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seed(page);
  await page.evaluate(async tripId => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { newVisit } = await import('../../src/domain/visits');
    const db = await LibraryDb.open();
    for (let index = 1; index < 10; index++) await db.createVisit(newVisit(tripId, `重複地点 ${index}`, null, { latitude: 32.75, longitude: 129.87 }));
    db.close();
  }, ids.tripId);
  await page.reload();
  await page.locator('#trip-select').selectOption(ids.tripId);
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-layer-custom > summary').click();
  await page.locator('#visits-layer-toggle').check();
  await page.locator('#map-tools > summary').click();
  await expect.poll(async () => {
    if (!(await page.locator('#visit-map-chooser').isVisible())) await page.locator('#map').click({ position: { x: 908, y: 480 } });
    return page.locator('#visit-map-options button').count();
  }).toBe(10);
  await expect(page.locator('#map-photo-options button')).toHaveCount(1);
  await page.locator('#visit-map-options button').filter({ hasText: '重複地点 5' }).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集' }).click();
  await expect(page.locator('#visit-label')).toHaveValue('重複地点 5');
  await page.locator('#left-tab-visits').click();
  await expect(page.locator('#visit-list button').filter({ hasText: '重複地点 5' })).toHaveAttribute('aria-pressed', 'true');
});
