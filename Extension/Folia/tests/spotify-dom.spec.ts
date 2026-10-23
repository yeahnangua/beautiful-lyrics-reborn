import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(readFileSync(new URL('../../Source/LyricViews/DOM.ts', import.meta.url), 'utf8'));
async function prepare(page: Page, html: string) {
  await page.setContent(html);
  await page.addScriptTag({ type: 'module', content: `${source}\nwindow.domCompat = { FindPlaybarControls, BindPlaybarElements, FindNowPlayingAnchor };` });
  await expect.poll(() => page.evaluate(() => !!(window as any).domCompat)).toBe(true);
}
const bar = '<aside data-testid="now-playing-bar"><div class="hashed-controls"><button data-testid="fullscreen-mode-button" style="display:inline-flex"></button><div><button data-testid="control-button-queue"></button></div></div></aside>';

test('playback entries survive unmapped classes, delayed controls and React replacement', async ({ page }) => {
  await prepare(page, '<main></main>');
  await page.evaluate(() => {
    const state = (window as any).compatState = { visible: true, clicks: 0, buttons: [] as HTMLButtonElement[], binding: undefined as any };
    const buttons = ['lyrics', 'fullscreen'].map(id => {
      const button = document.createElement('button'); button.id = id;
      button.onclick = () => state.clicks++;
      return button;
    });
    state.buttons = buttons;
    state.binding = (window as any).domCompat.BindPlaybarElements(buttons, () => state.visible);
  });
  await page.locator('main').evaluate((element, html) => element.innerHTML = html, bar);
  await expect(page.locator('.hashed-controls > #lyrics')).toHaveCount(1);
  await expect(page.locator('.hashed-controls > #fullscreen')).toHaveCount(1);
  await expect(page.locator('[data-testid="fullscreen-mode-button"]')).toBeHidden();
  await page.locator('#lyrics').click();
  expect(await page.evaluate(() => (window as any).compatState.clicks)).toBe(1);

  await page.locator('main').evaluate((element, html) => element.innerHTML = html, bar);
  await expect(page.locator('.hashed-controls > #lyrics')).toHaveCount(1);
  await page.locator('#lyrics').click();
  expect(await page.evaluate(() => (window as any).compatState.clicks)).toBe(2);
  await page.evaluate(() => {
    const state = (window as any).compatState;
    state.visible = false; state.buttons.forEach((button: HTMLElement) => button.remove());
  });
  await page.locator('main').evaluate(element => element.append(document.createElement('div')));
  await expect(page.locator('#lyrics')).toHaveCount(0);
  await page.evaluate(() => { const state = (window as any).compatState; state.visible = true; state.binding.Update(); });
  await expect(page.locator('#lyrics')).toHaveCount(1);
  await page.evaluate(() => (window as any).compatState.binding.Destroy());
  await expect(page.locator('[data-testid="fullscreen-mode-button"]')).toHaveCSS('display', 'inline-flex');
  await page.locator('main').evaluate((element, html) => element.innerHTML = html, bar);
  await expect(page.locator('#lyrics')).toHaveCount(0);
});

test('legacy controls remain supported and sidebar anchors stay inside the scroll viewport', async ({ page }) => {
  await prepare(page, '<div class="main-nowPlayingBar-extraControls" id="legacy"></div><div id="contents"></div>');
  expect(await page.evaluate(() => (window as any).domCompat.FindPlaybarControls().id)).toBe('legacy');
  const contents = page.locator('#contents');
  await contents.evaluate(element => element.innerHTML = '<div class="main-nowPlayingView-nowPlayingWidget" id="old-widget"></div>');
  expect(await contents.evaluate(element => (window as any).domCompat.FindNowPlayingAnchor(element)?.id)).toBe('old-widget');
  await contents.evaluate(element => element.innerHTML = '<div data-overlayscrollbars-viewport><div><div id="cover"><a href="/album/example"><img alt="Cover"></a></div><div><div id="widget"><div><span><a href="/album/example">Song</a></span></div><div>Artist</div></div><section><h2>Lyrics preview</h2></section></div></div></div>');
  expect(await contents.evaluate(element => (window as any).domCompat.FindNowPlayingAnchor(element)?.id)).toBe('widget');
  await contents.evaluate(element => element.innerHTML = '<div data-overlayscrollbars-viewport><a href="/album/example">Song</a></div><section><h2>Outside the scroll container</h2></section>');
  expect(await contents.evaluate(element => (window as any).domCompat.FindNowPlayingAnchor(element))).toBeNull();
});
