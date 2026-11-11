import { test, expect } from '@playwright/test';

for (const hasAttributionLine of [false, true]) {
  test(`lrc.red link remains visible with hasAttributionLine=${hasAttributionLine}`, async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('.folia-app')).toBeVisible();
    await page.evaluate(hasAttributionLine => {
      const fixture = (window as any).testFolia;
      fixture.update({ lyrics: { ...fixture.getPlayer().lyrics, hasAttributionLine,
        attribution: { provider: 'lrc.red', source: 'lrc.red' } } });
    }, hasAttributionLine);
    const credit = page.locator('.folia-attribution');
    const link = credit.getByRole('link', { name: 'lrc.red', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://lrc.red');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(credit).toHaveText(hasAttributionLine ? 'lrc.red' : 'Lyrics via lrc.red');
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    await expect(link).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('lrc-red-credit.png') });
    await page.evaluate(() => (window as any).testFolia.destroy());
    await expect(page.locator('.folia-attribution')).toHaveCount(0);
  });
}
