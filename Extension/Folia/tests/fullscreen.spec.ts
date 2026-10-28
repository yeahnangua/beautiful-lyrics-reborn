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
for (const mode of ['classic','cadenza','partita','tilt','diorama','sonnet','tempera','lumiere']) {
  test(`${mode}: lyric gaps stay blank instead of showing instrumental`, async ({page}) => {
    await page.goto('/');
    await page.getByRole('button',{name:'Visual settings',exact:true}).click();
    await page.getByLabel('Lyrics mode',{exact:true}).selectOption(mode);
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(() => {
      const fixture=(window as any).testFolia;
      fixture.update({playing:false,lyrics:{status:'synced',direction:'ltr',staticLines:[],lines:[
        {fullText:'First lyric',startTime:10,endTime:12,words:[{text:'First lyric',startTime:10,endTime:12}]},
        {fullText:'Next lyric',startTime:30,endTime:32,words:[{text:'Next lyric',startTime:30,endTime:32}]},
      ]}});
    });
    for (const time of [5,20,40]) {
      await page.evaluate(time => (window as any).testFolia.setTime(time),time);
      // Allow the compiled renderer's empty-state transition to finish.
      await page.waitForTimeout(600);
      await expect(page.locator('.folia-visual-surface')).not.toContainText(/Instrumental|纯音乐|ui\.waitingForMusic/);
      await expect(page.locator('.folia-empty')).toHaveCount(0);
    }
    await page.evaluate(() => (window as any).testFolia.setTime(31));
    // Canvas modes paint lyrics without DOM text; DOM modes use CSS word spacing.
    if (['classic','cadenza','partita','tilt'].includes(mode)) {
      await expect(page.locator('.folia-visual-surface')).toContainText(/Next\s*lyric/);
    }
    await page.evaluate(() => (window as any).testFolia.update({lyrics:{status:'instrumental',direction:'ltr',lines:[],staticLines:[]}}));
    await expect(page.locator('.folia-empty')).toHaveText('Instrumental');
  });
}
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

test('attribution: collapsed controls retain contributor links for synced/static lyrics and clear stale credits', async ({page, context}, testInfo) => {
  await context.route('https://spicylyrics.org/uid/**', route => route.fulfill({body:'Contributor profile'}));
  await page.goto('/');
  await expect(page.locator('.folia-app')).toBeVisible();
  const attribution = { provider:'spicylyrics', source:'spicy_lyrics',
    uploader:{id:'1',username:'Uploader',url:'https://spicylyrics.org/uid/1'},
    maker:{id:'2',username:'Maker',url:'https://spicylyrics.org/uid/2'} };
  for (const status of ['synced','static'] as const) {
    await page.evaluate(({status,attribution}) => {
      const fixture = (window as any).testFolia;
      fixture.update({lyrics:{...fixture.getPlayer().lyrics, status, staticLines:['First lyric','Last lyric'], attribution}});
    }, {status,attribution});
    await expect(page.locator('.folia-controls')).toHaveAttribute('data-expanded','false');
    const uploader = page.getByRole('link',{name:'🔗 Uploader',exact:true});
    await expect(uploader).toBeVisible();
    await expect(uploader).toHaveAttribute('href',attribution.uploader.url);
    await expect(page.getByRole('link',{name:'🔗 Maker',exact:true})).toHaveAttribute('href',attribution.maker.url);
    await expect(page.locator('.folia-attribution')).toContainText('Lyrics via spicylyrics');
  }
  await page.screenshot({path:testInfo.outputPath('attribution-static.png')});
  const [popup] = await Promise.all([page.waitForEvent('popup'),page.getByRole('link',{name:'🔗 Uploader',exact:true}).click()]);
  await popup.waitForLoadState(); expect(popup.url()).toBe(attribution.uploader.url); await popup.close();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('link',{name:'🔗 Uploader',exact:true})).toBeVisible();
  await page.evaluate(() => {
    const fixture=(window as any).testFolia;
    fixture.update({key:'spotify:track:next',lyrics:{status:'loading',direction:'ltr',lines:[],staticLines:[]}});
  });
  await expect(page.locator('.folia-attribution')).toHaveCount(0);
});

test('Worker attribution is an ordinary final lyric without a second provider caption', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.folia-app')).toBeVisible();
  await page.evaluate(() => {
    const fixture=(window as any).testFolia;
    fixture.update({playing:false, duration:80, lyrics:{status:'synced', direction:'ltr', staticLines:[],
      hasAttributionLine:true, attribution:{provider:'spicylyrics',source:'apple_music'},
      lines:[{id:'credit',agentId:'lead',fullText:'Lyrics via spicylyrics',startTime:79.9,endTime:80,
        words:[{text:'Lyrics via spicylyrics',startTime:79.9,endTime:80}]}]}});
    fixture.setTime(79.95);
  });
  await expect(page.locator('.folia-attribution')).toHaveCount(0);
  await expect(page.locator('.folia-visual-surface')).toContainText('Lyrics via spicylyrics');
  await page.evaluate(() => {
    const fixture=(window as any).testFolia;
    fixture.update({lyrics:{status:'static',direction:'ltr',lines:[],staticLines:['Last lyric','Lyrics via spicylyrics'],
      hasAttributionLine:true,attribution:{provider:'spicylyrics',source:'apple_music'}}});
  });
  await expect(page.locator('.folia-static p')).toHaveText(['Last lyric','Lyrics via spicylyrics']);
  await expect(page.locator('.folia-attribution')).toHaveCount(0);
});
