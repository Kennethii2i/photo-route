import { readFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { seedUi } from './helpers/ui-package';
import { seedLiveUi } from './helpers/ui-live-map';

const folder = 'specs/ui-package/d4b/after';
test.beforeEach(() => { test.setTimeout(60_000); mkdirSync(folder, { recursive: true }); });
async function shot(page: Page, name: string) {
  await page.waitForTimeout(180); await page.screenshot({ path: `${folder}/${name}.png` });
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const db = await LibraryDb.open();
    try {
      const data = await db.snapshot();
      const thumbnails = await Promise.all(data.thumbnails.map(async ({ blob, ...meta }) => ({ ...meta,
        digest: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(value => value.toString(16).padStart(2, '0')).join('') })));
      return { trips: data.trips.sort((a, b) => a.id.localeCompare(b.id)), visits: data.visits.sort((a, b) => a.id.localeCompare(b.id)),
        photos: data.photos.sort((a, b) => a.id.localeCompare(b.id)), thumbnails: thumbnails.sort((a, b) => a.id.localeCompare(b.id)),
        links: data.links.sort((a, b) => `${a.albumId}:${a.photoId}`.localeCompare(`${b.albumId}:${b.photoId}`)) };
    } finally { db.close(); }
  });
}

test('management prioritizes actions at 1440 390 and 320px and keeps modal keyboard controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); const ids = await seedLiveUi(page);
  for (const [width, height] of [[1440, 900], [390, 844], [320, 640]] as const) {
    await page.setViewportSize({ width, height }); await page.locator('#header-manage').click();
    await expect(page.locator('#export-button')).toBeInViewport();
    await expect(page.locator('#restore-button')).toBeDisabled();
    await expect(page.locator('#trash-count')).toHaveText('0件'); await expect(page.locator('#undo-button')).toBeHidden();
    await expect(page.locator('.manage-warning')).toContainText('高解像度写真は含まれません');
    await shot(page, `management-${width}`);
    const size = await page.locator('#management-panel').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, height: element.getBoundingClientRect().height }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1); if (width === 1440) expect(size.height).toBeLessThan(650);
    await page.locator('#management-close').focus(); await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#management-extra > summary')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.locator('#management-close')).toBeFocused();
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab');
      expect(await page.locator('#management-panel').evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.locator('#stream-method > summary').press('Enter');
    await expect(page.locator('#stream-export-button')).toBeVisible();
    await page.locator('#stream-method > summary').click();
    await page.locator('#archive-file').setInputFiles({ name: '合成_海辺の週末_旅行記録とサムネイルのバックアップ_2026年01月.zip', mimeType: 'application/zip', buffer: Buffer.from('not restored in this layout test') });
    await expect(page.locator('#archive-file-summary')).toBeVisible(); await expect(page.locator('#restore-button')).toBeEnabled();
    await page.locator('#restore-button').scrollIntoViewIfNeeded();
    await expect(page.locator('#archive-file-summary')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#restore-button')).toBeInViewport({ ratio: 1 });
    await shot(page, `selected-file-${width}`);
    await page.locator('#archive-file').setInputFiles([]);
    await expect(page.locator('#restore-button')).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(page.locator('#header-manage')).toBeFocused();
  }
  await page.setViewportSize({ width: 320, height: 480 }); await page.locator('#header-manage').click();
  await page.locator('#restore-button').scrollIntoViewIfNeeded(); await expect(page.locator('#restore-button')).toBeInViewport();
  await page.locator('#management-extra > summary').click(); await page.locator('#manage-trip').click();
  await expect(page.locator('#trip-name')).toBeVisible();
  await page.keyboard.press('Escape'); await page.locator('#header-add').click();
  await expect(page.locator('#photo-files')).toBeVisible();
  expect(ids.audit.blocked).toEqual([]); expect(ids.audit.failed).toEqual([]);
});

test('small ZIP download restore and invalid ZIP rejection preserve all backed-up data', async ({ page, browser }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true,
    value: async () => { throw new DOMException('Synthetic picker cancellation', 'AbortError'); } }));
  await seedUi(page); const before = await snapshot(page);
  await page.locator('#header-manage').click();
  await page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const original = LibraryDb.prototype.snapshot; let first = true;
    LibraryDb.prototype.snapshot = async function () {
      if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 1500)); }
      return original.call(this);
    };
  });
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-button').click();
  await expect(page.locator('#archive-cancel')).toBeVisible(); await shot(page, 'backup-running');
  const download = await downloadPromise; await download.saveAs(test.info().outputPath('synthetic.zip'));
  const zip = readFileSync(await download.path()); expect(zip.length).toBeGreaterThan(100);
  await expect(page.locator('#archive-status')).toContainText('実際に保存されたかはアプリでは確認できません');
  await page.locator('#stream-method > summary').click(); await page.locator('#stream-export-button').click();
  await expect(page.locator('#archive-status')).toContainText('ZIP処理を中断しました');
  expect(await snapshot(page)).toEqual(before);
  const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:5184', viewport: { width: 390, height: 844 } });
  try {
    const target = await fresh.newPage();
    await target.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:5184') return route.continue();
      if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/styles/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efeb' } }] }) });
      return route.abort();
    });
    await target.goto('/'); await target.locator('#header-manage').click();
    await expect(target.locator('#restore-button')).toBeDisabled();
    await target.locator('#archive-file').setInputFiles({ name: '合成_海辺の週末_バックアップ.zip', mimeType: 'application/zip', buffer: zip });
    await expect(target.locator('#archive-file-summary')).toContainText('合成_海辺の週末_バックアップ.zip');
    await target.locator('#restore-button').click();
    await expect(target.locator('#archive-status')).toContainText('1件の旅行と24件の写真を復元しました');
    expect(await snapshot(target)).toEqual(before);
    await target.locator('#archive-file').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from([1, 2, 3]) });
    await target.locator('#restore-button').click();
    await expect(target.locator('#archive-status')).toContainText('復元を拒否');
    await expect(target.locator('#restore-group #archive-status')).toBeVisible();
    await shot(target, 'restore-error-390'); expect(await snapshot(target)).toEqual(before);
  } finally { await fresh.close(); }
});

test('trash disclosure restore and Undo keep actual membership links intact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); const ids = await seedUi(page); const before = await snapshot(page);
  const trashAlbum = async () => {
    await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
    await page.getByRole('button', { name: '編集', exact: true }).click(); await page.locator('#visit-delete').click();
    await page.locator('#trash-commit').click(); await expect(page.locator('#trash-count')).toHaveText('1件');
    await expect(page.locator('#management-panel')).not.toBeVisible(); await page.locator('#header-manage').click();
    await page.locator('#trash-section > summary').click();
    await expect(page.locator('#undo-button')).toBeVisible();
  };
  await trashAlbum(); await shot(page, 'trash-open-1440');
  await page.locator('#undo-button').click(); await expect(page.locator('#trash-count')).toHaveText('0件');
  expect((await snapshot(page)).links).toEqual(before.links);
  await page.keyboard.press('Escape'); await trashAlbum();
  await page.locator('#trash-section > summary').click(); await expect(page.locator('#trash-list')).toBeHidden();
  await page.locator('#trash-section > summary').click(); await page.locator('#trash-list button').first().click();
  await expect(page.locator('#trash-count')).toHaveText('0件');
  const after = await snapshot(page); expect(after.links).toEqual(before.links); expect(after.photos).toEqual(before.photos);
  expect(after.visits.find(visit => visit.id === ids.albums[0])!.deletedAt).toBeNull();
  await expect(page.locator('#undo-summary')).toContainText('復元');
});
