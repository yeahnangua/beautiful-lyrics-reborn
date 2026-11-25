import { test, expect } from '@playwright/test';
test('mode and background tuning survive reload and reset without changing host preferences', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  await page.getByText('Mode parameters',{exact:true}).click();
  const rotation = page.getByLabel('classic.enableWordRotation',{exact:true});
  const original=await rotation.isChecked();
  await rotation.setChecked(!original);
  await page.reload();
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  await page.getByText('Mode parameters',{exact:true}).click();
  await expect(rotation).toBeChecked({checked:!original});
  await page.locator('.folia-tuning').first().getByRole('button',{name:'Reset',exact:true}).click();
  await expect(rotation).toBeChecked({checked:original});
  await expect(page.getByLabel('Lyrics mode',{exact:true})).toHaveValue('classic');
  await expect(page.getByLabel('Show subtitles',{exact:true})).not.toBeChecked();
  await page.getByText('Background parameters',{exact:true}).click();
  const display = page.getByLabel('background:latent.displayMode',{exact:true});
  await display.selectOption('mesh');
  await page.reload();
  await page.getByRole('button',{name:'Visual settings',exact:true}).click();
  await page.getByText('Background parameters',{exact:true}).click();
  await expect(display).toHaveValue('mesh');
});

test('hidden fullscreen releases visual canvases and restores the current mode',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.folia-app')).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Visual settings',exact:true})).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))});
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('.folia-app')).toHaveAttribute('data-mode','classic');
});
