import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const readViewSource = (file: string) =>
  stripTypeScriptTypes(readFileSync(new URL('../../Source/LyricViews/' + file, import.meta.url), 'utf8'))
    .replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["']/gm, '');

const fixture = `
  class Signal {
    listeners = new Set();
    Connect(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    Fire() { this.listeners.forEach(listener => listener()); }
  }
  const GetInstantStore = (_, __, Items) => ({ Items });
  const seedrandom = () => () => 0;
  const SongChanged = new Signal();
  const SongContextChanged = new Signal();
  let Song, SongContext;
  window.setCover = CoverArt => {
    Song = { Type: 'Streamed', Uri: 'spotify:track:fixture', CoverArt };
    SongChanged.Fire();
    return GetCoverArtForSong()[0];
  };
`;

async function centerPixel(page: Page) {
  return page.locator('.BeautifulLyricsBackground-Container').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl')!;
    return new Promise<number[]>(resolve => {
      const draw = gl.drawArrays;
      gl.drawArrays = (mode, first, count) => {
        draw.call(gl, mode, first, count);
        gl.drawArrays = draw;
        const pixel = new Uint8Array(4);
        gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        resolve(Array.from(pixel));
      };
    });
  });
}

test('the lyrics page renders Spotify cover colors and updates when the song changes', async ({ page }) => {
  const hash = 'ab67616d00001e02ff9ca10b55ce82ae553c8228';
  const coverUrl = 'https://i.scdn.co/image/' + hash;
  const secondCoverUrl = 'https://i.scdn.co/image/' + 'b'.repeat(40);
  for (const [url, color] of [[coverUrl, 'red'], [secondCoverUrl, 'lime']]) {
    await page.route(url, route => route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${color}"/></svg>`,
    }));
  }
  await page.route('**/lyrics-background-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<main class="BeautifulLyricsPage Contained" style="width:800px;height:600px"></main>',
  }));
  await page.goto('/lyrics-background-fixture');
  const sources = ['Shaders.ts', 'BackgroundRenderer.ts', 'Shared.ts'].map(readViewSource);
  await page.addScriptTag({ type: 'module', content: [
    fixture, ...sources, 'ApplyDynamicBackground(document.querySelector("main"), { Give: value => value });',
  ].join('\n') });
  await expect(page.locator('main canvas')).toBeVisible();

  const setCover = (cover: { Big?: string; Default?: string }) =>
    page.evaluate(value => (window as unknown as { setCover(cover: typeof value): string }).setCover(value), cover);
  expect(await setCover({ Big: 'spotify:image:' + hash })).toBe(coverUrl);
  await expect.poll(() => centerPixel(page)).toEqual([255, 0, 0, 255]);

  expect(await setCover({ Big: '', Default: secondCoverUrl })).toBe(secondCoverUrl);
  await expect.poll(() => centerPixel(page)).toEqual([0, 255, 0, 255]);
});
