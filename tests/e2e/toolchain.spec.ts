import { expect, test } from '@playwright/test';

test('the local Vite page loads in the installed Chrome browser', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Photo Route — 写真の場所を振り返る');
});
