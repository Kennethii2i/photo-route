import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { seedGroup, camera, records } from './helpers/coincident-photos';

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 7000 });
async function mapView(page: Page, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  if (width <= 700) await page.locator('#mobile-tab-map').click();
  else if (await page.locator('#drawer-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#drawer-toggle').click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function place(page: Page, count: number, x: number, y: number) {
  await page.evaluate(({ x, y }) => {
    const map = (window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map;
    map.easeTo({ center: [129.87, 32.73], zoom: 20, offset: [x - map.getContainer().clientWidth / 2, y - map.getContainer().clientHeight / 2], duration: 0 });
  }, { x, y });
  await expect.poll(() => page.evaluate(() => new Set((window as unknown as { v42Map: import('maplibre-gl').Map }).v42Map.queryRenderedFeatures({ layers: ['photo-points'] }).map(f => f.properties.id)).size)).toBeGreaterThanOrEqual(count);
  // The real cluster/point hit target remains at its saved coordinate.
  await page.mouse.click(x, y);
}
async function bounds(page: Page, count: number) {
  await expect(page.locator('.map-spider-photo')).toHaveCount(count);
  await expect(page.locator('.map-spider-photo img')).toHaveCount(count);
  await expect(page.locator('.map-photo-thumb.is-expanded')).toHaveCount(1);
  await expect(page.locator('.map-photo-thumb.is-expanded')).toBeHidden();
  const result = await page.evaluate(async () => {
    const { mapViewportInsets } = await import('../../src/presentation/map-viewport');
    const map = document.getElementById('map')!, m = map.getBoundingClientRect(), inset = mapViewportInsets(map);
    const safe = { left: m.left + inset.left, top: m.top + inset.top, right: m.right - inset.right, bottom: m.bottom - inset.bottom };
    const targets = [...document.querySelectorAll<HTMLButtonElement>('.map-spider-photo')].map(button => {
      const r = button.getBoundingClientRect(), image = button.querySelector('img')!.getBoundingClientRect();
      return { rect: r.toJSON(), image: image.toJSON(), hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    return { safe, targets };
  });
  for (const { rect, image, hit } of result.targets) {
    expect(hit).toBe(true); expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44);
    for (const r of [rect, image]) {
      expect(r.left).toBeGreaterThanOrEqual(result.safe.left + 4); expect(r.top).toBeGreaterThanOrEqual(result.safe.top + 4);
      expect(r.right).toBeLessThanOrEqual(result.safe.right - 4); expect(r.bottom).toBeLessThanOrEqual(result.safe.bottom - 4);
    }
  }
  for (let a = 0; a < result.targets.length; a++) for (let b = a + 1; b < result.targets.length; b++) {
    const r = result.targets[a]!.rect, s = result.targets[b]!.rect;
    expect(r.right + 3 <= s.left || s.right + 3 <= r.left || r.bottom + 3 <= s.top || s.bottom + 3 <= r.top).toBe(true);
  }
  await expect(page.locator('.map-spider-paging')).toHaveCount(0);
}
async function shot(page: Page, name: string) {
  mkdirSync('specs/ux-v4-2/screenshots', { recursive: true });
  await page.screenshot({ path: `specs/ux-v4-2/screenshots/${name}.png`, animations: 'disabled' });
}
async function dismiss(page: Page) {
  await page.keyboard.press('Escape'); await expect(page.locator('.map-spider-photo')).toHaveCount(0);
}

test('V4.2 seven photos fit fully at upper corners and bottom edges', async ({ page }) => {
  test.setTimeout(60_000);
  await seedGroup(page, 7); const before = await records(page);
  for (const width of [1440, 390, 320]) {
    await mapView(page, width);
    for (const [x, y] of [[20, 92], [width - 20, 92], [width / 2, 745]]) {
      await place(page, 7, x!, y!); const initial = await camera(page);
      await bounds(page, 7); expect(await camera(page)).toEqual(initial);
      if (x === 20 && width !== 320) await shot(page, `${width}-edge-seven`);
      await dismiss(page);
    }
  }
  expect(await records(page)).toEqual(before);
});

test('V4.2 twelve photos fit on narrow screens and every photo opens its own preview', async ({ page }) => {
  test.setTimeout(90_000);
  const ids = await seedGroup(page, 12), before = await records(page);
  for (const width of [390, 320]) {
    await mapView(page, width);
    for (const [index, id] of ids.group.entries()) {
      await place(page, 12, 20, 180); await bounds(page, 12);
      if (index === 0) await shot(page, `${width}-left-twelve`);
      const target = page.locator(`.map-spider-photo[data-photo-id="${id}"]`), label = await target.getAttribute('aria-label');
      await target.click(); await expect(page.locator('#photo-detail h3')).toHaveText(label!);
      await expect(page.locator('.map-spider-photo')).toHaveCount(0); await page.locator('#right-close').click();
    }
    await place(page, 12, 20, 180); await bounds(page, 12); const initial = await camera(page);
    await page.mouse.click(width / 2, 680); await expect(page.locator('.map-spider-photo')).toHaveCount(0);
    expect(await camera(page)).toEqual(initial);
  }
  expect(await records(page)).toEqual(before);
});

test('V4.2 fifteen photos still use the existing list with all photos reachable', async ({ page }) => {
  const ids = await seedGroup(page, 15), before = await records(page); await mapView(page, 320);
  await place(page, 15, 20, 92);
  await expect(page.locator('#map-photo-group-heading')).toHaveText('この地点の写真 15枚');
  await expect(page.locator('.map-spider-photo, .map-spider-paging')).toHaveCount(0);
  const seen = new Set<string>();
  for (let step = 0; step < 20; step++) {
    (await page.locator('#photo-list [data-photo-id]').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.photoId!))).forEach(id => seen.add(id));
    const end = await page.locator('#left-panel').evaluate(el => { const old = el.scrollTop; el.scrollTop += el.clientHeight * .7; return old === el.scrollTop; });
    if (end) break; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
  expect([...seen].sort()).toEqual([...ids.group].sort()); expect(await records(page)).toEqual(before);
  await expect(page.getByRole('button', { name: /Undo|元に戻す|取り消す|操作履歴/i, includeHidden: true })).toHaveCount(0);
});
