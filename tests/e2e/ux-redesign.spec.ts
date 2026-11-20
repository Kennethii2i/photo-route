import { expect, test, type Page } from '@playwright/test';
import { seedUi } from './helpers/ui-package';
import { mkdirSync, readFileSync } from 'node:fs';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7_000 });

async function fullPhoto(page: Page, id: string, name = '海辺-1.jpg') {
  await page.locator('#photo-search').fill(name);
  await page.locator(`#photo-list [data-photo-id="${id}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await page.locator('#photo-advanced > summary').click();
}

test('R1 correction drafts survive save redraw and guarded navigation', async ({ page }) => {
  const ids = await seedUi(page);
  await fullPhoto(page, ids.photos[0]!);
  await page.locator('#time-correction-clock').fill('2026:02:03 12:34:56');
  await page.locator('#gps-correction-latitude').fill('35.1');
  await page.locator('#gps-correction-longitude').fill('139.2');
  await page.getByRole('button', { name: 'GPS補正を保存', exact: true }).click();
  await expect(page.locator('.photo-summary')).toContainText('手動補正したWGS84位置');
  await expect(page.locator('#time-correction-clock')).toHaveValue('2026:02:03 12:34:56');
  await page.getByRole('button', { name: 'プレビューに戻る', exact: true }).click();
  await expect(page.locator('#photo-correction-leave')).toBeVisible();
  await page.locator('#correction-leave-keep').click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await expect(page.locator('#time-correction-clock')).toHaveValue('2026:02:03 12:34:56');
  await page.locator('#right-close').click();
  await page.locator('#correction-leave-stay').click();
  await expect(page.locator('#right-panel')).toBeVisible();
  await page.locator('#right-close').click();
  await page.locator('#correction-leave-discard').click();
  await expect(page.locator('#right-panel')).toBeHidden();
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await page.locator('#photo-advanced > summary').click();
  await expect(page.locator('#time-correction-clock')).toHaveValue('');
  const photo = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const photo = (await db.listPhotos()).find(photo => photo.id === id)!; db.close(); return photo;
  }, ids.photos[0]!);
  expect(photo.timeCorrection).toBeNull(); expect(photo.gpsCorrection?.value).toEqual({ latitude: 35.1, longitude: 139.2 });
  expect(photo.sourceGps.normalized).toEqual({ latitude: 32.73, longitude: 129.87 });
});

test('R1 unknown membership result cannot leave and conflict remains reachable', async ({ page }) => {
  const ids = await seedUi(page);
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await page.locator('#vpe-search').fill('街並み-2.jpg');
  await page.locator(`.vpe-tile[data-tile-id="${ids.photos[1]}"] input`).check();
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    LibraryDb.prototype.saveAlbumMembershipBatch = async () => { throw new Error('synthetic response loss'); };
    LibraryDb.prototype.albumMembershipOperationStatus = async () => 'unknown';
  });
  await page.locator('#vpe-save').click(); await expect(page.locator('#vpe-conflict')).toBeVisible();
  await page.locator('#vpe-conflict-close').click();
  await expect(page.locator('#vpe-save')).toBeDisabled();
  await expect(page.locator('#vpe-state-review')).toBeVisible();
  await page.locator('#vpe-close').click();
  await expect(page.locator('#vpe-conflict')).toBeVisible();
  await expect(page.locator('#vpe-leave')).toBeHidden();
  await page.locator('#vpe-conflict-close').click();
  await page.locator('#vpe-state-review').click();
  await expect(page.locator('#vpe-conflict')).toBeVisible();
  await expect(page.locator('#vpe-conflict-reason')).toContainText('保存結果');
});

test('R2 circular portrait landscape square images and permanent zoom controls', async ({ page }) => {
  const ids = await seedUi(page, { mobileEditing: true });
  const sizes = await page.evaluate(async () => {
    const results = [];
    for (const [width, height] of [[400, 600], [600, 400], [400, 400]]) {
      const canvas = document.createElement('canvas'); canvas.width = width!; canvas.height = height!;
      canvas.getContext('2d')!.fillRect(0, 0, width!, height!);
      const marker = document.createElement('span'); marker.className = 'map-photo-thumb is-selected';
      const clip = document.createElement('span'); clip.className = 'map-photo-thumb-clip';
      const img = document.createElement('img'); img.src = canvas.toDataURL(); clip.append(img); marker.append(clip);
      const badge = document.createElement('span'); badge.className = 'map-photo-thumb-count'; badge.textContent = '3'; marker.append(badge);
      document.body.append(marker); await img.decode();
      const box = clip.getBoundingClientRect(), image = img.getBoundingClientRect();
      results.push({ clipWidth: box.width, clipHeight: box.height, width: image.width, height: image.height,
        clipping: getComputedStyle(clip).overflow, outerClipping: getComputedStyle(marker).overflow,
        fit: getComputedStyle(img).objectFit, ring: getComputedStyle(marker).outlineStyle }); marker.remove();
    }
    return results;
  });
  for (const size of sizes) expect(size).toEqual({ clipWidth: 30, clipHeight: 30, width: 30, height: 30,
    clipping: 'hidden', outerClipping: 'visible', fit: 'cover', ring: 'solid' });
  await expect(page.locator('#map-tools')).not.toHaveAttribute('open', '');
  await expect(page.locator('#map-zoom-in')).toBeVisible();
  const before = await page.locator('#map-zoom-level').innerText();
  await page.locator('#map-zoom-in').click();
  await expect(page.locator('#map-zoom-level')).not.toHaveText(before);
  await page.locator('#map-zoom-out').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-tab-photos').click();
  await page.locator('#photo-search').fill('海辺の朝_長いファイル名');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.locator('#mobile-tab-map').click();
  await page.locator('#map-tools > summary').click();
  await page.locator('#map-marker-index > summary').click();
  await page.locator(`#map-marker-list [data-marker-id="${ids.photos[0]}"]`).click();
  await page.locator('#map-tools > summary').click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('.map-photo-thumb-clip img').first()).toBeVisible();
  const liveImage = await page.locator('.map-photo-thumb-clip img').first().boundingBox();
  expect(liveImage!.width).toBe(30); expect(liveImage!.height).toBe(30);
  await expect(page.locator('#map-zoom-in')).toBeVisible();
  await expect.poll(() => page.locator('#right-panel').evaluate(node => getComputedStyle(node).transform)).toBe('none');
  const [nav, preview, tabs] = await Promise.all(['#map-navigation', '#right-panel', '#mobile-tabs'].map(selector => page.locator(selector).boundingBox()));
  expect(nav!.y + nav!.height).toBeLessThanOrEqual(preview!.y);
  expect(preview!.y + preview!.height).toBeLessThanOrEqual(tabs!.y);
});

test('R3 edge drawer keeps selection filters scroll and camera without resizing map', async ({ page }) => {
  const ids = await seedUi(page);
  await page.locator('#photo-search').fill('海辺-1.jpg');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await page.locator('#photo-search').fill('');
  await expect.poll(() => page.locator('#left-panel').evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(250);
  await page.locator('#left-panel').evaluate(node => { node.scrollTop = 200; });
  await page.evaluate(async () => {
    const { PhotoMap } = await import('../../src/presentation/map.ts'); const original = PhotoMap.prototype.setViewportPadding;
    PhotoMap.prototype.setViewportPadding = function (...args) {
      const map = (this as unknown as { map: { getCenter(): unknown; getZoom(): number } }).map;
      const before = JSON.stringify([map.getCenter(), map.getZoom()]); original.apply(this, args);
      Object.assign(window, { __drawerCameraStable: before === JSON.stringify([map.getCenter(), map.getZoom()]) });
    };
  });
  const size = await page.locator('#map').boundingBox();
  await page.locator('#drawer-toggle').click();
  await expect(page.locator('#drawer-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#drawer-toggle').click();
  await expect(page.locator('#drawer-toggle')).toHaveAttribute('aria-expanded', 'true');
  expect(await page.locator('#left-panel').evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  expect(await page.locator('#map').boundingBox()).toEqual(size);
  expect(await page.evaluate(() => (window as unknown as { __drawerCameraStable: boolean }).__drawerCameraStable)).toBe(true);
  await expect(page.locator('#right-panel')).toBeVisible();
  await expect(page.locator('#header-left')).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 800 }); await page.locator('#drawer-toggle').click();
  await expect(page.locator('#left-panel')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#drawer-toggle')).toBeHidden();
  await expect(page.locator('#mobile-tabs')).toBeVisible();
});

test('R4 direct photo import keeps its start Trip when view closes and reports per-file failure', async ({ page }) => {
  const ids = await seedUi(page, { searchScenario: true });
  await page.evaluate(async () => {
    const { PhotoImporter } = await import('../../src/application/import-photos.ts'); const original = PhotoImporter.prototype.importFiles;
    PhotoImporter.prototype.importFiles = async function (...args) {
      await new Promise<void>(resolve => Object.assign(window, { __releaseImport: resolve })); return original.apply(this, args);
    };
  });
  await page.locator('#header-add').click();
  await expect(page.locator('#photo-import-dialog')).toBeVisible();
  await expect(page.locator('#management-panel')).toBeHidden();
  await expect(page.locator('#photo-import-trip')).toContainText('海辺の週末');
  await page.locator('#photo-files').setInputFiles([
    { name: 'synthetic-import.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') },
    { name: 'synthetic-broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) },
  ]);
  await page.locator('#import-button').click(); await page.locator('#import-close').click();
  await expect(page.locator('#import-task')).toBeVisible();
  await page.locator('#trip-select').selectOption(ids.otherTrip!);
  await page.locator('#import-task').click();
  await expect(page.locator('#photo-import-trip')).toContainText('海辺の週末');
  await page.evaluate(() => (window as unknown as { __releaseImport(): void }).__releaseImport());
  await expect(page.locator('#import-status')).toContainText('追加 1枚');
  await expect(page.locator('#import-status')).toContainText('失敗 1枚');
  await expect(page.locator('#import-again')).toBeEnabled();
  const imported = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const photos = (await db.listPhotos()).filter(photo => photo.originalFilename.startsWith('synthetic-')); db.close(); return photos;
  });
  expect(imported).toHaveLength(1); expect(imported[0]!.tripId).toBe(ids.trip);
  expect(imported[0]!.sourceTime.rawDateTimeOriginal).not.toBeNull();
  expect(imported[0]!.thumbnailState).toBe('available');
  await page.locator('#import-close').click(); await page.locator('#header-manage').click();
  await expect(page.locator('#management-panel #import-panel')).toHaveCount(0);
});

test('R4 cancellation stops unprocessed files without removing a committed photo', async ({ page }) => {
  const ids = await seedUi(page);
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.savePhoto;
    LibraryDb.prototype.savePhoto = async function (...args) {
      const result = await original.apply(this, args);
      await new Promise<void>(resolve => Object.assign(window, { __releaseSavedImport: resolve })); return result;
    };
  });
  await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles([
    { name: 'committed.jpg', mimeType: 'image/jpeg', buffer: readFileSync('fixtures/generated/jpeg_gps_offset_orientation6.jpg') },
    { name: 'not-processed.png', mimeType: 'image/png', buffer: readFileSync('fixtures/generated/png_no_metadata.png') },
  ]);
  await page.locator('#import-button').click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __releaseSavedImport?: unknown }).__releaseSavedImport)).toBe('function');
  await page.locator('#cancel-button').click();
  await page.evaluate(() => (window as unknown as { __releaseSavedImport(): void }).__releaseSavedImport());
  await expect(page.locator('#import-status')).toContainText('中断 1枚');
  const saved = await page.evaluate(async trip => {
    const { LibraryDb } = await import('../../src/infrastructure/storage'); const db = await LibraryDb.open();
    const photos = (await db.listPhotos()).filter(photo => photo.tripId === trip); db.close(); return photos;
  }, ids.trip);
  expect(saved).toHaveLength(25); expect(saved.some(photo => photo.originalFilename === 'committed.jpg')).toBe(true);
  expect(saved.some(photo => photo.originalFilename === 'not-processed.png')).toBe(false);
});

const shots = 'specs/ux-interaction-redesign/screenshots';
async function shot(page: Page, name: string) {
  mkdirSync(shots, { recursive: true });
  if (page.viewportSize()!.width > 700) {
    if (await page.locator('body').getAttribute('data-left-open') === 'true')
      await expect.poll(() => page.locator('#left-panel').evaluate(node => getComputedStyle(node).transform)).toBe('none');
    else await expect(page.locator('#left-panel')).toBeHidden();
  }
  if (await page.locator('body').getAttribute('data-right-open') === 'true')
    await expect.poll(() => page.locator('#right-panel').evaluate(node => getComputedStyle(node).transform)).toBe('none');
  else await expect(page.locator('#right-panel')).toBeHidden();
  await page.screenshot({ path: `${shots}/${name}.png` });
}

test('R5 blank click dismisses one browsing layer and keeps filters while gestures and controls do not close', async ({ page }) => {
  const ids = await seedUi(page);
  await expect(page.locator('.map-photo-thumb-clip img').first()).toBeVisible();
  await shot(page, 'pc1440-drawer-open');
  await page.locator('#drawer-toggle').click(); await shot(page, 'pc1440-drawer-closed');
  await page.locator('#drawer-toggle').click();
  await page.locator('#photo-search').fill('海辺-1.jpg');
  await page.locator(`#photo-list [data-photo-id="${ids.photos[0]}"]`).click();
  await shot(page, 'pc1440-preview-zoom');
  await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.move(800, 420, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(500); await expect(page.locator('#right-panel')).toBeVisible();
  await page.locator('#map-zoom-in').click(); await page.mouse.move(700, 200); await page.mouse.wheel(0, -100);
  await page.mouse.dblclick(700, 180); await page.waitForTimeout(550);
  await expect(page.locator('#right-panel')).toBeVisible();
  await page.mouse.click(700, 160);
  await expect(page.locator('#right-panel')).toBeHidden();
  await expect(page.locator('#left-panel')).toBeVisible();
  await expect(page.locator('#photo-search')).toHaveValue('海辺-1.jpg');
  await page.mouse.click(700, 160); await expect(page.locator('#left-panel')).toBeHidden();
  await page.locator('#drawer-toggle').click();
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await page.mouse.click(700, 160); await expect(page.locator('#left-panel')).toBeHidden();
  await expect(page.locator('#visit-focus-banner')).toBeVisible();
  await page.locator('#visit-focus-exit').click();
  await page.locator('#drawer-toggle').click();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.locator('#drawer-toggle').click();
  await page.locator('#map-tools > summary').click(); await page.locator('#map-fit').click(); await page.locator('#map-tools > summary').click();
  await shot(page, 'pc900-drawer-open');
});

test('R5 back restores album all-photo scroll while close ends the container and clears photo selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  const ids = await seedUi(page);
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '写真を見る', exact: true }).click();
  const panel = page.locator('#right-panel');
  await expect.poll(() => panel.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(30);
  await panel.evaluate(node => { node.scrollTop = 120; });
  const visibleId = await page.locator('#visit-all-photo-list .photo-tile').evaluateAll(nodes => {
    const panel = document.querySelector('#right-panel')!.getBoundingClientRect();
    return (nodes.find(node => { const box = node.getBoundingClientRect(); return box.top > panel.top + 40 && box.bottom < panel.bottom - 10; }) as HTMLElement)?.dataset.photoId;
  });
  expect(visibleId).toBeTruthy();
  const scroll = await panel.evaluate(node => node.scrollTop);
  await page.locator(`#visit-all-photo-list [data-photo-id="${visibleId}"]`).click();
  await page.getByRole('button', { name: 'アルバムへ戻る', exact: true }).click();
  await expect(page.locator('#visit-all-photos')).toBeVisible();
  await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBe(scroll);
  await page.locator(`#visit-all-photo-list [data-photo-id="${visibleId}"]`).click();
  await page.locator('#right-close').click(); await expect(panel).toBeHidden();
  expect(await page.locator('#photo-list [aria-pressed="true"]').count()).toBe(0);
  await expect(page.locator('#visit-summary')).toBeHidden();
});

test('R5 edits ignore blank clicks and mobile map preview import and narrow layout stay usable', async ({ page }) => {
  const ids = await seedUi(page);
  await fullPhoto(page, ids.photos[0]!);
  await page.locator('#gps-correction-latitude').fill('35.7');
  await page.mouse.click(700, 160); await page.waitForTimeout(450);
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('35.7');
  await page.locator('#right-close').click(); await page.keyboard.press('Escape');
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('35.7');
  await page.locator('#right-close').click(); await page.locator('#correction-leave-discard').click();
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.getByRole('button', { name: '編集', exact: true }).click(); await page.locator('#visit-label').fill('未保存の名前');
  await page.mouse.click(700, 160); await page.waitForTimeout(450);
  await expect(page.locator('#visit-label')).toHaveValue('未保存の名前');
  await page.locator('#right-close').click(); await page.locator('#correction-leave-stay').click();
  await page.locator('#right-close').click(); await page.locator('#correction-leave-discard').click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#mobile-tab-map').click();
  await page.locator('#map-tools > summary').click(); await page.locator('#map-marker-index > summary').click();
  await page.locator(`#map-marker-list [data-marker-id="${ids.photos[0]}"]`).click();
  await page.locator('#map-tools > summary').click();
  await page.getByRole('button', { name: '地図で見る', exact: true }).click();
  await expect(page.locator('.map-photo-thumb-clip img').first()).toBeVisible();
  await shot(page, 'mobile390-map-preview-zoom');
  await page.locator('#right-close').click(); await page.locator('#header-add').click();
  await shot(page, 'mobile390-photo-import');
  await page.setViewportSize({ width: 320, height: 740 }); await shot(page, 'mobile320-photo-import');
  expect(await page.locator('#photo-import-dialog').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(false);
  await page.locator('#import-close').click();
  await expect(page.locator('#mobile-tabs')).toBeVisible();
});
