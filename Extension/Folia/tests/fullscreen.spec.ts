import { test, expect } from '@playwright/test';

// All modes run against the bundled original renderer rather than mocked components.
const modes = ['classic','cadenza','partita','cappella','tilt','claddagh','monet','diorama','pendolo','sonnet','tempera','lumiere','still'];
for(const mode of modes) test(`${mode}: renders, pauses, seeks, resizes and releases its surface`,async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  await page.getByLabel('Lyrics mode',{exact:true}).selectOption(mode);
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.folia-app')).toHaveAttribute('data-mode',mode);
  await page.waitForTimeout(1800);
  await expect(page.getByRole('alert')).toHaveCount(0);
  if(mode !== 'still') {
    const canvas = await page.locator('[data-paper-shader] canvas').first().boundingBox();
    expect(canvas?.width).toBeGreaterThanOrEqual(1440);
    expect(canvas?.height).toBeGreaterThanOrEqual(900);
  }
  await page.screenshot({path:testInfo.outputPath(`${mode}.png`)});
  await page.getByRole('button',{name:'Pause',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Play',exact:true}).first()).toBeVisible();
  await page.getByLabel('Playback position',{exact:true}).focus();await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=> (window as any).testFolia.calls.some((call:any)=>call.type==='seek'))).toBe(true);
  await page.setViewportSize({width:850,height:650});
  await expect(page.locator('.folia-controls')).toBeVisible();
  await page.evaluate(()=> (window as any).testFolia.destroy());
  await page.waitForTimeout(200);
  expect(await page.locator('canvas').count()).toBe(0);
  expect(errors).toEqual([]);
});
test('static, loading, missing, instrumental, RTL and settings persistence',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.folia-app')).toBeVisible();
  for(const status of ['loading','missing','instrumental','static']){
    await page.evaluate(status=>{const fixture=(window as any).testFolia;fixture.update({lyrics:{status,lines:[],staticLines:['مرحبا بالعالم','第二行  spaces'],direction:'rtl'}});},status);
    await expect(page.locator('.folia-app')).toHaveAttribute('dir','rtl');
    if(status==='static')await expect(page.getByText('مرحبا بالعالم',{exact:true})).toBeVisible();
    else await expect(page.locator('.folia-empty')).toBeVisible();
  }
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  await page.getByLabel('Lyrics mode',{exact:true}).selectOption('monet');
  await page.getByLabel('Background',{exact:true}).selectOption('sora');
  await page.reload();
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  await expect(page.getByLabel('Lyrics mode',{exact:true})).toHaveValue('monet');
  await expect(page.getByLabel('Background',{exact:true})).toHaveValue('sora');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('playback and library controls call host actions and CSS does not leak into Spotify',async({page})=>{
  await page.goto('/');
  const before=await page.locator('#spotify-fixture button').evaluate(node=>getComputedStyle(node).borderRadius);
  await page.locator('.folia-controls').hover();
  for(const name of ['Previous track','Next track','Shuffle','Like','Report lyrics problem'])await page.getByRole('button',{name,exact:true}).click();
  await page.getByRole('button',{name:'Add to playlist',exact:true}).click();
  await page.getByRole('button',{name:/Fixture playlist/}).click();
  await expect.poll(()=>page.evaluate(()=> (window as any).testFolia.calls.some((call:any)=>call.type==='playlist'))).toBe(true);
  expect(await page.locator('#spotify-fixture button').evaluate(node=>getComputedStyle(node).borderRadius)).toBe(before);
  expect(await page.evaluate(()=>document.head.querySelectorAll('style[data-paper-shader]').length)).toBe(0);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  for(let i=0;i<5;i++){await page.evaluate(()=>{(window as any).testFolia.destroy();(window as any).testFolia.mount();});await page.waitForTimeout(100);}
  await expect(page.locator('.folia-app')).toHaveCount(1);
});
test('five backgrounds, display preferences, offset controls and rendering fallback',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  for(const background of ['common','monet','nomand','latent','sora']){
    await page.getByLabel('Background',{exact:true}).selectOption(background);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.getByRole('button',{name:'Lyrics offset +0.2s',exact:true}).click();
  await expect(page.getByRole('status',{name:'Lyrics offset',exact:true})).toHaveText('+0.2s');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.getByLabel('Show lyrics',{exact:true}).uncheck();
  await page.getByLabel('Show subtitles',{exact:true}).uncheck();
  await expect(page.getByLabel('Show lyrics',{exact:true})).not.toBeChecked();
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('canvas').first().evaluate(node=>node.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await expect(page.locator('.folia-app')).toHaveAttribute('data-mode','still');
  await expect(page.getByRole('alert')).toContainText('Showing Still');
  await expect(page.getByRole('button',{name:'Pause',exact:true}).first()).toBeVisible();
});
test('subtitles are off by default, all 13 modes are available, and saved preferences are respected',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  await expect(page.getByLabel('Show subtitles',{exact:true})).not.toBeChecked();
  await expect(page.getByLabel('Show lyrics',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Lyrics mode',{exact:true}).locator('option')).toHaveCount(13);
  await expect(page.getByLabel('Lyrics mode',{exact:true}).locator('option[value="fume"]')).toHaveCount(0);
  await page.getByLabel('Show subtitles',{exact:true}).check();
  await page.reload();
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  await expect(page.getByLabel('Show subtitles',{exact:true})).toBeChecked();
});
