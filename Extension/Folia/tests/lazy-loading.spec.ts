import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const bytes = readFileSync(new URL('../dist/folia.mjs', import.meta.url));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const descriptor = { api: 1, sha256, file: `beautiful-lyrics-reborn-fullscreen.${sha256.slice(0, 16)}.mjs` };
const cacheKey = `https://lyrics.txw.qzz.io/extension/${descriptor.file}`;
const asset = '**/beautiful-lyrics-reborn-fullscreen.*.mjs';
async function prepare(page: Page) {
  await page.addInitScript(release => { (window as any).fullscreenRelease = release; }, descriptor);
  await page.goto('/?lazy');
  await expect.poll(() => page.evaluate(() => !!(window as any).testFolia)).toBe(true);
}
const open = (page: Page) => page.evaluate(() => (window as any).testFolia.open());
const close = (page: Page) => page.evaluate(() => (window as any).testFolia.destroy());

test('real runtime stays unloaded at startup, shares first download and reuses memory and verified browser cache', async ({ page }) => {
  let requests = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes(descriptor.file)) requests++; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(asset, async route => { await gate; await route.fulfill({ contentType: 'text/javascript', body: bytes }).catch(() => {}); });
  await prepare(page);
  expect(requests).toBe(0);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await expect(page.locator('.folia-app')).toHaveCount(0);
  const first = page.evaluate(() => Promise.all([(window as any).testFolia.open(), (window as any).testFolia.open()]));
  await expect.poll(() => requests).toBe(2);
  await page.evaluate(() => (window as any).testFolia.update({ key: 'spotify:track:new', title: 'Switched while downloading' }));
  release();
  expect(await first).toEqual(['network', 'network']);
  await expect(page.locator('.folia-app')).toHaveCount(1);
  await expect(page.getByText('Switched while downloading', { exact: true }).first()).toBeVisible();
  await close(page);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(await open(page)).toBe('memory');
  expect(requests).toBe(2);
  await close(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).testFolia)).toBe(true);
  expect(requests).toBe(2);
  expect(await open(page)).toBe('cache');
  await expect(page.locator('.folia-app')).toHaveCount(1);
  expect(requests).toBe(2);
  await close(page);
  expect(errors).toEqual([]);
});

test('real browser rejects corrupt cache and mirror hashes, then imports verified CDN bytes', async ({ page }) => {
  const origins: string[] = [];
  await page.route(asset, async route => {
    origins.push(new URL(route.request().url()).hostname);
    await route.fulfill({ contentType: 'text/javascript', body: route.request().url().includes('cdn.jsdelivr.net') ? bytes : Buffer.from('throw Error("unverified module executed")') });
  });
  await prepare(page);
  await page.evaluate(async key => { const cache = await caches.open('BeautifulLyrics/Fullscreen/v1'); await cache.put(key, new Response('corrupt')); }, cacheKey);
  expect(await open(page)).toBe('network');
  expect(origins.sort()).toEqual(['cdn.jsdelivr.net', 'lyrics.20050129.xyz', 'lyrics.txw.qzz.io']);
  await expect(page.locator('.folia-app')).toHaveCount(1);
  expect(await page.evaluate(async key => {
    const response = await (await caches.open('BeautifulLyrics/Fullscreen/v1')).match(key);
    const hash = await crypto.subtle.digest('SHA-256', await response!.arrayBuffer());
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }, cacheKey)).toBe(sha256);
  await close(page);
});

test('closing during download prevents late execution and allows retry after both mirrors fail', async ({ page }) => {
  let requests = 0, retry = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(asset, async route => {
    requests++;
    if (!retry) { await gate; await route.fulfill({ contentType: 'text/javascript', body: bytes }).catch(() => {}); }
    else if (route.request().url().includes('cdn.jsdelivr.net')) await route.fulfill({ contentType: 'text/javascript', body: bytes });
    else await route.fulfill({ status: 503, body: 'Unavailable' });
  });
  await prepare(page);
  const pending = page.evaluate(() => (window as any).testFolia.open().then(() => 'mounted', (error: Error) => error.name));
  await expect.poll(() => requests).toBe(2);
  await close(page);
  expect(await pending).toBe('AbortError');
  release();
  await expect(page.locator('.folia-app')).toHaveCount(0);
  expect(await page.evaluate(() => caches.keys())).toEqual(['BeautifulLyrics/Fullscreen/v1']);
  retry = true;
  expect(await open(page)).toBe('network');
  await expect(page.locator('.folia-app')).toHaveCount(1);
  expect(requests).toBe(5);
  await close(page);
});
