import { test, expect } from '@playwright/test';
import { adminHtml } from '../../../Server/src/admin';
import { sourceProviders } from '../../../Server/src/source-providers';

test('every registered provider is selectable, filterable and blockable from feedback', async ({ page }) => {
  const writes: Record<string, unknown>[] = [], filters: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const report = (provider: string) => ({ id: provider, createdAt: '2026-11-17T00:00:00Z',
    track: { id: 'track', name: 'Song', artists: ['Artist'] }, source: { Provider: provider, Transport: 'direct' },
    category: 'timing', status: 'pending', description: 'Timing issue', original: { Type: 'Line', Content: [] }, history: [],
  });
  await page.route('**/admin-fixture', route => route.fulfill({ contentType: 'text/html', body: adminHtml }));
  await page.route('**/admin/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/admin/api/reports') {
      const provider = url.searchParams.get('source');
      if (provider) filters.push(provider);
      return route.fulfill({ json: { items: (provider ? [provider] : sourceProviders).map(id => ({
        id, created_at: '2026-11-17T00:00:00Z', song: 'Song', artists: 'Artist', spotify_id: 'track',
        provider: id, category: 'timing', status: 'pending',
      })), nextCursor: null } });
    }
    if (url.pathname.startsWith('/admin/api/reports/')) {
      return route.fulfill({ json: report(url.pathname.split('/').at(-1)!) });
    }
    if (url.pathname === '/admin/api/source-blocks' && request.method() === 'PUT') {
      const input = request.postDataJSON(); writes.push(input);
      return route.fulfill({ json: { ...input, id: 'rule', history: [] } });
    }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/admin-fixture');
  await expect(page.locator('#workspace')).toBeVisible();
  for (const id of ['sourceFilter', 'blockSourceFilter', 'blockProvider']) {
    const options = await page.locator(`#${id} option`).evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value));
    expect(options.filter(value => value && value !== 'unknown')).toEqual([...sourceProviders]);
  }
  for (const provider of ['betterlyrics', 'betterlyrics-qq', 'betterlyrics-kugou', 'unison']) {
    await page.locator('#sourceFilter').selectOption(provider);
    await page.locator('#filters').getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.locator('#rows tr')).toHaveCount(1);
    await page.locator('#rows').getByRole('button', { name: '查看', exact: true }).click();
    await expect(page.locator('#blockFromReport')).toBeEnabled();
    await page.locator('#blockFromReport').click();
    await expect(page.locator('#blockProvider')).toHaveValue(provider);
    await page.locator('#blockSave').click();
    await expect(page.locator('#blockEditMessage')).toHaveText('已保存规则');
    expect(writes.at(-1)).toMatchObject({ spotifyId: 'track', provider, lyricsType: 'Line', enabled: true, reportId: provider });
    await page.locator('#blockClose').click();
    await page.locator('#close').click();
  }
  expect(filters).toEqual(['betterlyrics', 'betterlyrics-qq', 'betterlyrics-kugou', 'unison']);
  expect(errors).toEqual([]);
});
