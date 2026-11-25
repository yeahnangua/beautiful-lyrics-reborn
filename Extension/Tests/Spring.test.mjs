import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source=stripTypeScriptTypes(await readFile(new URL('../../Universal/Modules/Spring.ts',import.meta.url),'utf8'),{mode:'transform'}).replace('export default class','class');
const Spring=new Function(source+';return Spring')();
test('small syllable motion stays awake until both position and velocity settle',()=>{
 const spring=new Spring(1,4,.5);spring.SetGoal(1.075);spring.Step(1/60);
 assert.equal(spring.CanSleep(),false);
 let frames=0;while(!spring.CanSleep()&&frames++<1000)spring.Step(1/60);
 assert.ok(frames>1&&frames<1000);assert.ok(Math.abs(spring.GetPosition()-1.075)<1/3840);
 spring.SetGoal(1,true);assert.equal(spring.GetPosition(),1);assert.equal(spring.CanSleep(),true);
});
