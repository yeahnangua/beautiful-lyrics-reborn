import { test, expect } from '@playwright/test';
import { dashboardHtml as html } from '../../../Server/src/dashboard';
const excludedCacheRows = [
  {cacheVersion:'workers-cache-v1',cache:'hit',outcome:'cancelled',count:'100'},
  {cacheVersion:'workers-cache-v2',cache:'miss',outcome:'cancelled',count:'100'},
  {cacheVersion:'workers-cache-v1',cache:'bypass',outcome:'none',count:'100'},
  {cacheVersion:'workers-cache-v2',cache:'unknown',outcome:'failed',count:'100'},
  {cacheVersion:'workers-cache-v2',cache:'none',outcome:'failed',count:'100'},
  {cacheVersion:'',cache:'hit',outcome:'success',count:'900'},
  {cacheVersion:'d1-v1',cache:'hit',outcome:'success',count:'900'},
  {cacheVersion:'workers-cache-v0',cache:'hit',outcome:'success',count:'900'},
  {cacheVersion:'workers-cache-v0',cache:'miss',outcome:'success',count:'900'},
];
const data = {
  days: 30, total: 10, syllable: {count:8,percent:80}, line:{count:2,percent:20},
  metrics: {available:true,server:[{outcome:'success',lyricsType:'Syllable',count:10,since:'2026-10-23'}],
    providers:[{provider:'qqmusic',transport:'direct',stage:'syllable',outcome:'success',count:8,selected:8,retries:0},{provider:'qqmusic',transport:'direct',stage:'syllable',outcome:'cancelled',count:20,selected:0,retries:0}],
    providerLatency:[{provider:'qqmusic',transport:'direct',avgMs:500,p50Ms:400,p95Ms:900}],
    client:[{kind:'session',count:10,since:'2026-10-23'},{kind:'fullscreen_first',count:2},{kind:'lyrics_load',source:'cache',outcome:'success',lyricsType:'Line',count:5,avgMs:50,p50Ms:40,p95Ms:80},{kind:'lyrics_load',source:'prefetch',outcome:'success',count:2},{kind:'lyrics_load',source:'network',outcome:'success',count:1},{kind:'lyrics_load',source:'network',outcome:'none',count:1},{kind:'lyrics_load',source:'network',outcome:'failed',count:1},{kind:'fullscreen_mode',mode:'classic',count:2}],
    cache:[
      {cacheVersion:'workers-cache-v1',cache:'hit',outcome:'success',count:'4'},
      {cacheVersion:'workers-cache-v1',cache:'miss',outcome:'success',count:'6'},
      {cacheVersion:'workers-cache-v2',cache:'hit',outcome:'success',count:'6'},
      {cacheVersion:'workers-cache-v2',cache:'miss',outcome:'success',count:'2'},
      {cacheVersion:'workers-cache-v2',cache:'miss',outcome:'none',count:'1'},
      {cacheVersion:'workers-cache-v2',cache:'miss',outcome:'failed',count:'1'},
      {cacheVersion:'workers-cache-v3',cache:'hit',outcome:'success',count:'2'},
      {cacheVersion:'workers-cache-v3',cache:'miss',outcome:'success',count:'3'},
      ...excludedCacheRows,
    ],
    latency:[{origin:'server',kind:'request',avgMs:500,p50Ms:400,p95Ms:900}],trend:[{day:'2026-10-23',origin:'server',kind:'request',dimension:'success',count:10}]},
};
test('statistics displays weighted provider rates, client metrics, empty data and stale range responses safely', async ({ page }) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.route('**/statistics-fixture',route=>route.fulfill({contentType:'text/html',body:html}));
  let delayed: (()=>void)|undefined;
  await page.route('**/stats?days=*',async route=>{
    const days=Number(new URL(route.request().url()).searchParams.get('days'));
    if(days===7)await new Promise<void>(resolve=>{delayed=resolve});
    await route.fulfill({json:{...data,days}}).catch(()=>{});
  });
  await page.goto('/statistics-fixture');
  await expect(page.locator('#details')).toContainText('100.0%');
  await expect(page.locator('#details')).toContainText('QQ 音乐');
  await expect(page.locator('#details')).toContainText('20.0%');
  await expect(page.locator('.number').filter({hasText:'客户端缓存'}).locator('strong')).toHaveText('70.0%');
  const serverCache=page.locator('.number').filter({hasText:'服务端缓存率'});
  await expect(serverCache.locator('strong')).toHaveText('48.0%');
  await expect(serverCache.locator('p')).toHaveText('命中 12 / 查询 25');
  await expect(page.locator('.note')).toContainText('从 2026-11-10 上线起，按所选时间范围跨版本累计 Worker 缓存');
  await expect(page.locator('.ring .arc')).toHaveCount(2);
  await page.getByRole('button',{name:'7 天'}).click();
  await expect.poll(()=>!!delayed).toBe(true);
  await page.getByRole('button',{name:'90 天'}).click();
  await expect(page.locator('#totalLine')).toContainText('90 天');
  delayed?.();await expect(page.locator('#totalLine')).toContainText('90 天');
  await page.screenshot({path:test.info().outputPath('statistics-wide.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('statistics-narrow-data.png'),fullPage:true,animations:'disabled'});
  await page.route('**/stats?days=*',route=>route.fulfill({json:{...data,total:0,metrics:{available:true,server:[],client:[],providers:[],latency:[],trend:[]}}}));
  await page.getByRole('button',{name:'30 天'}).click();
  await expect(page.locator('#details')).toContainText('暂无数据');
  await expect(serverCache.locator('strong')).toHaveText('暂无数据');
  expect(errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath('statistics-narrow.png')});
});

test('server cache distinguishes real misses from excluded or unavailable data', async ({ page }) => {
  await page.route('**/statistics-fixture',route=>route.fulfill({contentType:'text/html',body:html}));
  let metrics={...data.metrics,cache:[{cacheVersion:'workers-cache-v1',cache:'miss',outcome:'success',count:'4'}]};
  await page.route('**/stats?days=*',route=>route.fulfill({json:{...data,metrics}}));
  await page.goto('/statistics-fixture');
  const serverCache=page.locator('.number').filter({hasText:'服务端缓存率'});
  await expect(serverCache.locator('strong')).toHaveText('0.0%');
  await expect(serverCache.locator('p')).toHaveText('命中 0 / 查询 4');
  metrics={...metrics,cache:excludedCacheRows};
  await page.getByRole('button',{name:'7 天'}).click();
  await expect(serverCache.locator('strong')).toHaveText('暂无数据');
  metrics={...data.metrics,available:false};
  await page.getByRole('button',{name:'90 天'}).click();
  await expect(serverCache.locator('strong')).toHaveText('暂无数据');
  await expect(page.locator('.number').filter({hasText:'客户端缓存'}).locator('strong')).toHaveText('暂无数据');
});
