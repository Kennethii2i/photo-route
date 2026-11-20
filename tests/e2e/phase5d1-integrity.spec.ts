import { readFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { localUi, createTripUi, photoListUi } from './helpers/ux-rc-flows';
test.use({ actionTimeout: 7000 });

async function state(page: Page) {
  return page.evaluate(async () => {
    const { LibraryDb } = await import('../../src/infrastructure/storage');
    const { validateAlbumLinks, validateRelations } = await import('../../src/domain/model');
    const db = await LibraryDb.open(), snapshot = await db.snapshot(); db.close();
    validateRelations(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.thumbnails);
    validateAlbumLinks(snapshot.trips, snapshot.visits, snapshot.photos, snapshot.links);
    return { ...snapshot, thumbnails: snapshot.thumbnails.map(({ blob, ...thumb }) => ({ ...thumb, size: blob.size })) };
  });
}

async function albumEditor(page: Page, id: string) {
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${id}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
}

test('import, two memberships, both editors, Undo, trash and ZIP v2 restore preserve data', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const origin = test.info().project.use.baseURL as string;
  const external = await localUi(page);
  await page.goto('/');
  await createTripUi(page, 'B5合成旅行');
  await page.locator('#header-add').click();
  for (const [name, path, count] of [
    ['one.jpg', 'fixtures/generated/jpeg_gps_offset_orientation6.jpg', 1],
    ['two.jpg', 'fixtures/generated/jpeg_gps_no_datum.jpg', 2],
  ] as const) {
    await page.locator('#photo-files').setInputFiles({ name, mimeType: 'image/jpeg', buffer: readFileSync(path) });
    await page.locator('#import-button').click();
    await expect(page.locator('#photo-list button[data-photo-id]')).toHaveCount(count);
  }
  await page.locator('#import-done').click(); await photoListUi(page);
  const imported = await state(page);
  const photo = imported.photos.find(item => item.originalFilename === 'one.jpg')!;
  expect(photo.visitId).toBeNull();
  await page.locator('#left-tab-visits').click();
  for (const name of ['アルバムA', 'アルバムB']) {
    await page.locator('#visit-create-from-list').click();
    await page.locator('#visit-label').fill(name);
    await page.locator('#visit-save').click();
    await expect(page.locator('#visit-list button').filter({ hasText: name })).toHaveCount(1);
  }
  const created = await state(page);
  const a = created.visits.find(item => item.label === 'アルバムA')!;
  const b = created.visits.find(item => item.label === 'アルバムB')!;
  const tile = page.locator(`.vpe-tile[data-tile-id="${photo.id}"] input[type=checkbox]`);
  for (const album of [a, b]) {
    await albumEditor(page, album.id);
    if (album.id === a.id) {
      const folder = 'specs/phase-b5-1/screenshots'; mkdirSync(folder, { recursive: true });
      await page.screenshot({ path: `${folder}/album-editor-1440.png` });
    }
    await tile.check(); await page.locator('#vpe-save').click();
    await expect(page.locator('#vpe-status')).toContainText('1枚追加');
    await page.locator('#vpe-close').click();
  }
  expect((await state(page)).links.filter(link => link.photoId === photo.id).map(link => link.albumId).sort()).toEqual([a.id, b.id].sort());
  for (const album of [a, b]) {
    await page.locator(`#visit-list button[data-visit-id="${album.id}"]`).click();
    await expect(page.locator('#visit-summary')).toContainText('写真 1枚');
  }
  await albumEditor(page, a.id);
  await tile.uncheck(); await page.locator('#vpe-save').click();
  await expect(page.locator('#vpe-status')).toContainText('1枚解除');
  expect((await state(page)).links.filter(link => link.photoId === photo.id).map(link => link.albumId)).toEqual([b.id]);
  await page.locator('#vpe-close').click();
  await page.locator('#left-tab-photos').click();
  await page.locator(`#photo-list button[data-photo-id="${photo.id}"]`).click();
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-album-edit-open').click();
  await expect(page.locator('#photo-album-editor')).toBeVisible();
  await page.screenshot({ path: 'specs/phase-b5-1/screenshots/photo-editor-1440.png' });
  await page.locator(`.pae-album[data-album-id="${a.id}"] input[type=checkbox]`).check();
  await page.locator('#pae-save').click();
  await expect(page.locator('#pae-status')).toContainText('1件追加');
  expect((await state(page)).links.filter(link => link.photoId === photo.id).map(link => link.albumId).sort()).toEqual([a.id, b.id].sort());
  await page.locator('#pae-undo').click();
  await expect(page.locator('#pae-status')).toContainText('Undoしました');
  expect((await state(page)).links.filter(link => link.photoId === photo.id).map(link => link.albumId)).toEqual([b.id]);
  await page.locator('#pae-close').click();
  await page.locator('#left-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${b.id}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-delete').click(); await page.locator('#trash-commit').click();
  expect((await state(page)).links.some(link => link.photoId === photo.id && link.albumId === b.id)).toBe(true);
  await expect(page.locator('#management-panel')).not.toBeVisible();
  await page.locator('#header-manage').click();
  await page.locator('#trash-section > summary').click();
  await page.getByRole('button', { name: 'アルバム: アルバムBを復元' }).click();
  const final = await state(page);
  expect(final.visits.find(item => item.id === b.id)?.deletedAt).toBeNull();
  expect(final.links.filter(link => link.photoId === photo.id).map(link => link.albumId)).toEqual([b.id]);
  expect(final.photos.find(item => item.id === photo.id)).toEqual(photo);
  const folder = 'specs/phase-b5-1/screenshots'; mkdirSync(folder, { recursive: true });
  for (const [width, height] of [[1440, 900], [900, 800], [390, 844], [320, 700]] as const) {
    await page.setViewportSize({ width, height });
    await page.locator('#management-panel').evaluate(dialog => { dialog.scrollTop = 0; });
    await page.screenshot({ path: `${folder}/integrated-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const download = page.waitForEvent('download');
  await page.locator('#archive-heading').scrollIntoViewIfNeeded(); await page.locator('#export-button').click();
  const archive = readFileSync(await (await download).path());
  const isolated = await browser.newContext();
  try {
    const target = await isolated.newPage();
    await target.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort('blockedbyclient'));
    await target.goto('/'); await target.locator('#header-manage').click(); await target.locator('#archive-heading').scrollIntoViewIfNeeded();
    await target.locator('#archive-file').setInputFiles({ name: 'b5-synthetic.zip', mimeType: 'application/zip', buffer: archive });
    await target.locator('#restore-button').click();
    await expect(target.locator('#archive-status')).toContainText('1件の旅行と2件の写真を復元');
    expect(await state(target)).toEqual(final);
  } finally { await isolated.close(); }
  await page.locator('#management-close').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-tab-visits').click();
  await page.locator(`#visit-list button[data-visit-id="${a.id}"]`).click();
  await page.locator('#visit-summary').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#visit-photo-edit-open').click();
  await expect(page.locator('#visit-photo-editor-overlay')).toBeVisible();
  await page.screenshot({ path: `${folder}/album-editor-390.png` });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator('.vpe-tile img').first()).toBeVisible();
  await page.screenshot({ path: `${folder}/album-editor-320.png` });
  await page.locator('#vpe-close').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-tab-photos').click();
  await page.locator(`#photo-list button[data-photo-id="${photo.id}"]`).click();
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await page.locator('#photo-album-edit-open').click();
  await expect(page.locator('#photo-album-editor')).toBeVisible();
  await page.screenshot({ path: `${folder}/photo-editor-390.png` });
  expect(external).toEqual([]);
});
