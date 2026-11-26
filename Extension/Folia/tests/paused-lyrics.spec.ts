import { test, expect } from '@playwright/test';

for (const mode of ['classic', 'partita']) {
  test(`${mode}: paused seeks and mode switches show the current words`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.folia-app')).toBeVisible();
    await page.evaluate(() => {
      const fixture = (window as any).testFolia;
      fixture.update({ playing: false, lyrics: { status: 'synced', direction: 'ltr', staticLines: [], lines: [
        { id: 'first', fullText: 'Earlier lyric', startTime: 10, endTime: 14,
          words: [{ text: 'Earlier lyric', startTime: 10, endTime: 14 }] },
        { id: 'next', fullText: 'Paused lyric', startTime: 30, endTime: 34,
          words: [{ text: 'Paused lyric', startTime: 30, endTime: 34 }] },
      ] } });
      fixture.setTime(31);
    });
    const selectMode = async (value: string) => {
      await page.getByRole('button', { name: 'Visual settings', exact: true }).click();
      await page.getByLabel('Lyrics mode', { exact: true }).selectOption(value);
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    };
    const expectPaintedWord = async (word: string) => {
      await expect.poll(() => page.locator('[data-visualizer-style] .will-change-transform.whitespace-nowrap').evaluateAll((nodes, word) =>
        nodes.some(node => {
          if (!node.textContent?.includes(word)) return false;
          let opacity = 1;
          for (let element: Element | null = node; element; element = element.parentElement) {
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            opacity *= Number(style.opacity);
          }
          return opacity > 0.5 && node.getBoundingClientRect().width > 0;
        }), word)).toBe(true);
    };
    await selectMode(mode);
    await expectPaintedWord('Paused');
    await selectMode('still');
    await selectMode(mode);
    await expectPaintedWord('Paused');
    await page.evaluate(() => (window as any).testFolia.setTime(11));
    await expectPaintedWord('Earlier');
    expect(await page.evaluate(() => (window as any).testFolia.getPlayer().playing)).toBe(false);
  });
}
