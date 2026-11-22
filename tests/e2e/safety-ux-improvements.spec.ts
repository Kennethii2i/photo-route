import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { seedUi } from './helpers/ui-package';
import { localUi, photoListUi } from './helpers/ux-rc-flows';

test.use({ viewport: { width: 1440, height: 900 } });

async function openCorrection(page: Page, photoId: string): Promise<void> {
  await photoListUi(page);
  await page.locator('#photo-search').fill('');
  // Search the synthetic name so the requested tile is inside the virtual window.
  const name = await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const db = await LibraryDb.open();
    const photo = (await db.listPhotos()).find(item => item.id === id)!; db.close(); return photo.originalFilename;
  }, photoId);
  await page.locator('#photo-search').fill(name);
  await page.locator(`#photo-list [data-photo-id="${photoId}"]`).click();
  await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
  await page.locator('#photo-advanced > summary').click();
}

async function screenshot(page: Page, name: string): Promise<void> {
  mkdirSync('test-results/safety-ux', { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `test-results/safety-ux/${name}.png`, animations: 'disabled' });
}

test('two connections reject stale edits, allow independent corrections, and roll back record/history together', async ({ page }) => {
  await localUi(page); await page.goto('/');
  const result = await page.evaluate(async () => {
    const { seedAlbumDb } = await import('../../tests/e2e/phase-b2-fixtures');
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    const { manualGpsCorrection, manualTimeCorrection } = await import('../../src/domain/corrections');
    const ids = await seedAlbumDb(1); const first = await LibraryDb.open(ids.name), second = await LibraryDb.open(ids.name);
    const photo = (await first.listPhotos())[0]!, album = (await first.listVisits()).find(item => item.id === ids.albumIds[0])!;
    const gps = manualGpsCorrection(36, 140), time = manualTimeCorrection('2026:01:02 10:00:00', '');
    await first.updateVisit({ ...album, label: 'Newer name' }, album);
    await first.updatePhotoCorrection(photo.id, { gpsCorrection: gps }, { gpsCorrection: photo.gpsCorrection });
    const beforeConflict = { snapshot: await first.snapshot(), history: await first.listRecovery() };
    const conflicts: string[] = [];
    try { await second.updateVisit({ ...album, label: 'Stale name' }, album); } catch (error) { conflicts.push((error as Error).name); }
    try { await second.updatePhotoCorrection(photo.id, { gpsCorrection: null }, { gpsCorrection: photo.gpsCorrection }); } catch (error) { conflicts.push((error as Error).name); }
    const afterConflict = { snapshot: await first.snapshot(), history: await first.listRecovery() };
    await second.updatePhotoCorrection(photo.id, { timeCorrection: time }, { timeCorrection: photo.timeCorrection });
    const merged = (await first.listPhotos())[0]!;
    const beforeFailure = { snapshot: await first.snapshot(), history: await first.listRecovery() };
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'recovery') throw new DOMException('Synthetic history failure', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    const failures: string[] = [];
    try {
      try { await second.updatePhotoCorrection(photo.id, { gpsCorrection: null }, { gpsCorrection: gps }); } catch (error) { failures.push((error as Error).name); }
      const latestAlbum = (await second.listVisits()).find(item => item.id === album.id)!;
      try { await second.updateVisit({ ...latestAlbum, label: 'Should roll back' }, latestAlbum); } catch (error) { failures.push((error as Error).name); }
    } finally { IDBObjectStore.prototype.add = original; }
    const afterFailure = { snapshot: await first.snapshot(), history: await first.listRecovery() };
    first.close(); second.close();
    return { conflicts, beforeConflict, afterConflict, merged, gps, time, failures, beforeFailure, afterFailure };
  });
  expect(result.conflicts).toEqual(['EditConflict', 'EditConflict']);
  expect(result.afterConflict).toEqual(result.beforeConflict);
  expect(result.merged.gpsCorrection).toEqual(result.gps); expect(result.merged.timeCorrection).toEqual(result.time);
  expect(result.failures).toEqual(['QuotaExceededError', 'QuotaExceededError']); expect(result.afterFailure).toEqual(result.beforeFailure);
});

test('correction acknowledgement preserves other input and typing during a delayed save', async ({ page }) => {
  const ids = await seedUi(page); await openCorrection(page, ids.photos[0]!);
  await page.locator('#gps-correction-latitude').fill('35'); await page.locator('#gps-correction-longitude').fill('139');
  await page.locator('#time-correction-clock').fill('2026:01:02 10:00:00');
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.updatePhotoCorrection;
    LibraryDb.prototype.updatePhotoCorrection = async function (...args) {
      await new Promise<void>(resolve => { (window as unknown as { releaseCorrection: () => void }).releaseCorrection = resolve; });
      LibraryDb.prototype.updatePhotoCorrection = original; return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'GPS補正を保存', exact: true }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { releaseCorrection?: () => void }).releaseCorrection));
  await page.locator('#gps-correction-latitude').fill('36');
  await page.evaluate(() => (window as unknown as { releaseCorrection: () => void }).releaseCorrection());
  await expect(page.getByRole('button', { name: 'GPS補正を保存', exact: true })).toBeEnabled();
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('36');
  await expect(page.locator('#time-correction-clock')).toHaveValue('2026:01:02 10:00:00');
  await page.locator('#gps-correction-latitude').fill('36.000'); await page.locator('#gps-correction-longitude').fill('139.000');
  await page.getByRole('button', { name: 'GPS補正を保存', exact: true }).click();
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('36');
  await expect(page.locator('.photo-correction-draft-status')).toContainText('未保存');
  await page.getByRole('button', { name: '撮影日時補正を保存', exact: true }).click();
  await expect(page.locator('.photo-correction-draft-status')).toHaveText('');
});

test('a delayed capacity read cannot postpone import startup and erase a cancellation request', async ({ page }) => {
  await seedUi(page); await photoListUi(page); await page.locator('#header-add').click();
  await page.locator('#photo-files').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: readFileSync('fixtures/generated/png_no_metadata.png') });
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const { PhotoImporter } = await import('../../src/application/import-photos.ts');
    const counts = LibraryDb.prototype.backupCounts, getTrip = LibraryDb.prototype.getTrip, importFiles = PhotoImporter.prototype.importFiles;
    LibraryDb.prototype.backupCounts = async function () {
      await new Promise<void>(resolve => { (window as unknown as { releaseCapacity: () => void }).releaseCapacity = resolve; });
      LibraryDb.prototype.backupCounts = counts; return counts.call(this);
    };
    LibraryDb.prototype.getTrip = async function (id) {
      await new Promise<void>(resolve => { (window as unknown as { releaseTripRead: () => void }).releaseTripRead = resolve; });
      LibraryDb.prototype.getTrip = getTrip; return getTrip.call(this, id);
    };
    PhotoImporter.prototype.importFiles = function (...args) {
      (window as unknown as { importStarted: boolean }).importStarted = true;
      PhotoImporter.prototype.importFiles = importFiles; return importFiles.apply(this, args);
    };
  });
  await page.locator('#import-button').click();
  await page.waitForFunction(() => Boolean((window as unknown as { releaseTripRead?: () => void; importStarted?: boolean }).releaseTripRead));
  await page.locator('#cancel-button').click();
  await page.evaluate(() => {
    const state = window as unknown as { releaseTripRead: () => void; releaseCapacity: () => void };
    state.releaseTripRead(); state.releaseCapacity();
  });
  await expect(page.locator('#import-status')).toContainText('中断');
  await expect(page.locator('#import-status')).toContainText('追加 0枚');
  const count = await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const db = await LibraryDb.open(); const photos = await db.listPhotos(); db.close(); return photos.length;
  });
  expect(count).toBe(24);
});

for (const width of [1440, 390, 320]) test(`capacity guidance and correction conflict remain usable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const ids = await seedUi(page);
  await page.locator('#header-manage').click();
  await expect(page.locator('#backup-capacity')).toContainText('写真 24枚 / ZIP上限5000枚');
  await expect(page.locator('#backup-capacity')).toContainText('全旅行・ごみ箱');
  await expect(page.locator('#restore-backup-capacity')).toContainText('復元後に上限内となる保証はありません');
  await page.locator('#export-button').scrollIntoViewIfNeeded(); await expect(page.locator('#export-button')).toBeEnabled();
  await screenshot(page, `${width}-backup-warning`);
  await page.locator('#management-close').click();
  await openCorrection(page, ids.photos[0]!);
  await page.locator('#gps-correction-latitude').fill('35'); await page.locator('#gps-correction-longitude').fill('139');
  await page.locator('#time-correction-clock').fill('2026:01:02 10:00:00');
  await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const { manualGpsCorrection } = await import('../../src/domain/corrections');
    const db = await LibraryDb.open(); await db.updatePhotoCorrection(id, { gpsCorrection: manualGpsCorrection(37, 141) }); db.close();
  }, ids.photos[0]!);
  await page.getByRole('button', { name: 'GPS補正を保存', exact: true }).click();
  await expect(page.locator('form[aria-label="GPS補正"] [role="status"]')).toContainText('入力を保持');
  // A plain retry still rejects; it never silently adopts the newer expectation.
  await page.getByRole('button', { name: 'GPS補正を保存', exact: true }).click();
  await page.getByRole('button', { name: '最新状態を確認', exact: true }).click();
  await expect(page.locator('form[aria-label="GPS補正"] [role="status"]')).toContainText('37, 141');
  await expect(page.getByRole('button', { name: 'この保存値を基準に編集を続ける' })).toBeFocused();
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('35');
  await expect(page.locator('#time-correction-clock')).toHaveValue('2026:01:02 10:00:00');
  await page.getByRole('button', { name: 'この保存値を基準に編集を続ける' }).scrollIntoViewIfNeeded();
  await screenshot(page, `${width}-correction-conflict`);
  await page.getByRole('button', { name: 'この保存値を基準に編集を続ける' }).press('Enter');
  await expect(page.locator('#gps-correction-latitude')).toBeFocused();
  await page.getByRole('button', { name: 'GPS補正を保存', exact: true }).click();
  await expect(page.locator('#gps-correction-latitude')).toHaveValue('35');
  await expect(page.locator('#time-correction-clock')).toHaveValue('2026:01:02 10:00:00');
});

test('album name conflict preserves input until the latest name is explicitly adopted', async ({ page }) => {
  const ids = await seedUi(page);
  if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-label').fill('保持する入力');
  await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const db = await LibraryDb.open();
    const album = (await db.listVisits()).find(item => item.id === id)!;
    await db.updateVisit({ ...album, label: '他画面の最新名' }, album); db.close();
  }, ids.albums[0]!);
  await page.locator('#visit-save').click(); await expect(page.locator('#visit-status')).toContainText('入力を保持');
  await page.locator('#visit-save').click(); await expect(page.locator('#visit-label')).toHaveValue('保持する入力');
  await page.getByRole('button', { name: '最新状態を確認', exact: true }).click(); await expect(page.locator('#visit-status')).toContainText('他画面の最新名');
  await page.getByRole('button', { name: 'この保存値を基準に編集を続ける' }).click(); await page.locator('#visit-save').click();
  await expect(page.locator('#visit-summary h3')).toHaveText('保持する入力');
});

test('a delayed album conflict lookup cannot replace another album editing session', async ({ page }) => {
  const ids = await seedUi(page);
  if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#drawer-toggle').click();
  await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-label').fill('Old session draft');
  await page.evaluate(async id => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const db = await LibraryDb.open(); const album = (await db.listVisits()).find(item => item.id === id)!;
    await db.updateVisit({ ...album, label: 'Other tab' }, album); db.close();
  }, ids.albums[0]!);
  await page.locator('#visit-save').click(); await expect(page.locator('#visit-status')).toContainText('入力を保持');
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage.ts'); const original = LibraryDb.prototype.listVisits;
    LibraryDb.prototype.listVisits = async function () {
      // Restore immediately so unrelated navigation reads are not blocked.
      LibraryDb.prototype.listVisits = original;
      await new Promise<void>(resolve => { (window as unknown as { releaseAlbumLookup: () => void }).releaseAlbumLookup = resolve; });
      return original.call(this);
    };
  });
  await page.getByRole('button', { name: '最新状態を確認', exact: true }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { releaseAlbumLookup?: () => void }).releaseAlbumLookup));
  // Revert only the local name input so existing navigation guards permit switching.
  await page.locator('#visit-label').fill('港と街の散歩');
  await page.locator('#visit-edit-back').click();
  await page.locator(`#visit-list [data-visit-id="${ids.albums[1]}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-label').fill('New session draft');
  await page.evaluate(() => (window as unknown as { releaseAlbumLookup: () => void }).releaseAlbumLookup());
  await expect(page.locator('#visit-status')).toHaveText(''); await expect(page.locator('#visit-label')).toHaveValue('New session draft');
  await page.locator('#visit-save').click(); await expect(page.locator('#visit-summary h3')).toHaveText('New session draft');
});

test('virtual photo grids keep focus on resize, cross Tab windows, and provide an offscreen fallback', async ({ page }) => {
  await localUi(page); await page.goto('/');
  const expected = await page.evaluate(async () => {
    const { PhotoGrid } = await import('../../src/presentation/photo-grid');
    const { seedAlbumDb } = await import('../../tests/e2e/phase-b2-fixtures'); const { LibraryDb } = await import('../../src/infrastructure/storage.ts');
    const ids = await seedAlbumDb(120); const db = await LibraryDb.open(ids.name); const photos = await db.listPhotos(); db.close();
    const shell = document.createElement('section'); shell.style.cssText = 'position:fixed;inset:0;background:white;z-index:99999;padding:10px';
    document.body.append(shell); let selections = 0;
    for (const name of ['normal', 'album']) {
      const before = document.createElement('button'); before.id = `${name}-before`; before.textContent = 'Before';
      const viewport = document.createElement('div'); viewport.id = `${name}-viewport`; viewport.style.cssText = 'width:360px;height:230px;overflow:auto';
      const sticky = document.createElement('div'); sticky.className = 'panel-top'; sticky.style.cssText = 'height:44px;box-sizing:border-box'; sticky.textContent = 'Sticky grid heading'; viewport.append(sticky);
      const list = document.createElement('ul'); list.id = `${name}-grid`; list.style.cssText = 'margin:0;padding:0;list-style:none'; viewport.append(list);
      const after = document.createElement('button'); after.id = `${name}-after`; after.textContent = 'After'; shell.append(before, viewport, after);
      const grid = new PhotoGrid(list, viewport, async () => undefined, () => { selections++; }); grid.setPhotos(photos, name);
      (window as unknown as Record<string, unknown>)[`${name}Grid`] = grid;
    }
    (window as unknown as { gridSelections: () => number }).gridSelections = () => selections;
    return photos.map(photo => photo.id).sort();
  });
  for (const name of ['normal', 'album']) {
    const grid = page.locator(`#${name}-grid`); await grid.locator('[data-photo-id]').first().focus();
    for (let index = 1; index <= 22; index++) {
      await page.keyboard.press('Tab'); await expect(page.locator(':focus')).toHaveAttribute('data-photo-id', expected[index]!);
    }
    for (let index = 21; index >= 18; index--) {
      await page.keyboard.press('Shift+Tab'); await expect(page.locator(':focus')).toHaveAttribute('data-photo-id', expected[index]!);
      await expect.poll(() => page.evaluate(({ name, id }) => {
        const active = document.activeElement, viewport = document.getElementById(`${name}-viewport`);
        if (!(active instanceof HTMLButtonElement) || !active.isConnected || active.dataset.photoId !== id || !viewport?.contains(active)) return false;
        const header = viewport.querySelector('.panel-top'); if (!header) return false;
        const rect = active.getBoundingClientRect(), heading = header.getBoundingClientRect(), area = viewport.getBoundingClientRect();
        return rect.top >= heading.bottom - 1 && rect.bottom <= area.bottom + 1;
      }, { name, id: expected[index]! })).toBe(true);
    }
    await page.locator(`#${name}-viewport`).evaluate(el => { el.style.width = '260px'; });
    await expect(page.locator(':focus')).toHaveAttribute('data-photo-id', expected[18]!);
    await page.locator(`#${name}-viewport`).evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(grid).toBeFocused();
    await expect.poll(() => page.locator(`#${name}-viewport`).evaluate(el => el.scrollTop > 1000)).toBe(true);
    await page.locator(`#${name}-after`).focus();
    await page.locator(`#${name}-viewport`).evaluate(el => { el.style.width = '360px'; });
    await expect(page.locator(`#${name}-after`)).toBeFocused();
    await expect(grid.locator('[data-photo-id]').last()).toHaveAttribute('data-photo-id', expected.at(-1)!);
    await grid.locator(`[data-photo-id="${expected.at(-1)}"]`).focus(); await page.keyboard.press('Tab'); await expect(page.locator(`#${name}-after`)).toBeFocused();
    await page.evaluate(name => {
      const grid = (window as unknown as Record<string, { setPhotos: (photos: never[], key: string) => void }>)[`${name}Grid`]!;
      document.querySelector<HTMLButtonElement>(`#${name}-grid button`)?.focus(); grid.setPhotos([], name);
    }, name);
    await expect(grid).toBeFocused();
  }
  expect(await page.evaluate(() => (window as unknown as { gridSelections: () => number }).gridSelections())).toBe(0);
});
