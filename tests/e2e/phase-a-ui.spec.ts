import { expect, test } from '@playwright/test';

test('empty Photo and Album views stay clear at desktop and mobile widths', async ({ page }) => {
  const origin = test.info().project.use.baseURL as string;
  const external: string[] = [];
  await page.route('**/*', route => route.request().url().startsWith(origin)
    ? route.continue() : (external.push(route.request().url()), route.abort('blockedbyclient')));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#photo-count')).toContainText('0件');
  await expect(page.locator('#photo-list')).toContainText('未分類の写真はありません');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase-a-pc-1440-empty-photos.png' });
  await page.locator('#left-tab-visits').click();
  await expect(page.locator('#visit-list')).toContainText('旅行を選ぶとアルバムを作成できます');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase-a-pc-1440-empty-albums.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-tab-visits').click();
  await expect(page.locator('#visit-list')).toContainText('旅行を選ぶとアルバムを作成できます');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase-a-mobile-390-empty-albums.png' });
  await page.locator('#header-manage').click();
  await page.locator('#manage-archive').click();
  await expect(page.locator('#archive-heading').locator('..')).toContainText('元の高解像度写真は含まれません');
  await page.screenshot({ path: 'test-results/phase-a-shots/phase-a-mobile-390-management.png' });
  await page.locator('#management-close').click();
  expect(external).toEqual([]);
});
