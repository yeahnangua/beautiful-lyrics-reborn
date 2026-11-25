import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const descriptor=JSON.parse(readFileSync(new URL('../dist/auxiliary.json',import.meta.url),'utf8')).nebbia;
const bytes=readFileSync(new URL('../dist/'+descriptor.file,import.meta.url));
test('Nebbia loads its verified auxiliary data only on demand and reuses browser storage',async({page})=>{
 let requests=0;
 await page.route('**/'+descriptor.file,async route=>{requests++;await route.fulfill({body:bytes,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'}})});
 await page.goto('/');
 await expect(page.locator('.folia-app')).toBeVisible();
 expect(requests).toBe(0);
 await page.getByRole('button',{name:'Visual settings',exact:true}).click();
 await page.getByLabel('Lyrics mode',{exact:true}).selectOption('nebbia');
 await expect.poll(()=>requests).toBe(1);
 await expect.poll(()=>page.evaluate(async key=>!!(await (await caches.open('BeautifulLyrics/Auxiliary/v1')).match('https://lyrics.txw.qzz.io/Release/'+key)),descriptor.file),{timeout:20000}).toBe(true);
 await page.reload();
 await expect(page.locator('.folia-app')).toHaveAttribute('data-mode','nebbia');
 await expect(page.locator('canvas').first()).toBeVisible();
 expect(requests).toBe(1);
});
