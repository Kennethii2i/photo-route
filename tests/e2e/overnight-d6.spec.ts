import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedUi } from './helpers/ui-package';
import { seedLiveUi } from './helpers/ui-live-map';

const folder = 'specs/overnight-2026-11-20/d6';
test.beforeEach(() => { mkdirSync(folder, { recursive: true }); });
test('album photo browsing retains distinct preview and album return actions on desktop', async ({ page }) => {
  const ids = await seedUi(page);
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(200);
    if (await page.locator('body').getAttribute('data-left-open') === 'false') await page.locator('#header-left').click();
    await page.locator('#left-tab-visits').click(); await page.locator(`#visit-list [data-visit-id="${ids.albums[0]}"]`).click();
    await page.getByRole('button', { name: '写真を見る', exact: true }).click();
    await expect(page.locator('#visit-all-heading')).toHaveText('港と街の散歩');
    expect((await page.locator('.visit-all-header').boundingBox())!.height).toBeLessThan(80);
    const filename = await page.locator('#visit-all-photo-list button').first().getAttribute('aria-label');
    await page.locator('#visit-all-photo-list button').first().click(); await page.getByRole('button', { name: '詳細を見る', exact: true }).click();
    await expect(page.locator('#photo-detail h3')).toHaveText(filename!);
    const preview = page.getByRole('button', { name: 'プレビューに戻る', exact: true });
    const album = page.getByRole('button', { name: 'アルバムへ戻る', exact: true });
    expect(await preview.locator('path').getAttribute('d')).not.toBe(await album.locator('path').getAttribute('d'));
    await preview.click(); await expect(page.locator('#photo-advanced')).toHaveCount(0);
    await page.getByRole('button', { name: 'アルバムへ戻る', exact: true }).click();
    await expect(page.locator('#visit-summary h3')).toHaveText('港と街の散歩');
    await page.locator('#right-close').click();
  }
});
test('mobile map marker opens a compact preview with accessible close and detail actions', async ({ page }) => {
  test.setTimeout(60_000); await page.setViewportSize({ width: 390, height: 844 }); const ids = await seedLiveUi(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.locator('#mobile-tab-map').click();
    await page.locator('#map-tools > summary').click(); await page.locator('#map-fit').click(); await page.locator('#map-tools > summary').click();
    await expect(page.locator('.map-photo-thumb img').first()).toBeVisible();
    const center = await page.locator('.map-photo-thumb').evaluateAll(items => {
      const box = items.map(item => item.getBoundingClientRect()).find(rect => rect.x > 5 && rect.right < innerWidth - 5 && rect.y > 80 && rect.bottom < innerHeight - 110);
      return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    });
    expect(center).not.toBeNull(); await page.mouse.click(center!.x, center!.y);
    await expect(page.locator('body')).toHaveAttribute('data-right-open', 'true'); await expect(page.locator('#photo-detail img')).toBeVisible();
    await expect(page.locator('#right-close')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '詳細を見る', exact: true })).toBeInViewport({ ratio: 1 });
    expect((await page.locator('#right-panel').boundingBox())!.height).toBeLessThan(260);
    await expect.poll(async () => {
      const attribution = await page.locator('.maplibregl-ctrl-attrib').boundingBox(), panel = await page.locator('#right-panel').boundingBox();
      return attribution!.y + attribution!.height <= panel!.y + 1;
    }).toBe(true);
    await page.waitForTimeout(200); await page.screenshot({ path: `${folder}/map-preview-${width}.png` });
    await page.getByRole('button', { name: '詳細を見る', exact: true }).click(); await expect(page.locator('#photo-album-edit-open')).toBeVisible();
    await page.locator('#right-close').click();
  }
  expect(ids.audit.failed).toEqual([]); expect(ids.audit.blocked).toEqual([]);
});
