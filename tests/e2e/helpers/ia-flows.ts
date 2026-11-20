import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export async function emptyLibrary(page: Page) {
  const origin = `http://127.0.0.1:${process.env.PHOTO_ROUTE_TEST_PORT ?? '5184'}`;
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto('/'); await expect(page.locator('#photo-count')).toHaveText('0件');
}
export async function shot(page: Page, name: string) {
  const folder = 'specs/ia-2-3/screenshots'; mkdirSync(folder, { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `${folder}/${name}.png`, animations: 'disabled' });
}
