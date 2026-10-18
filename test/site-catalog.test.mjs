import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {sites} from '../scripts/sites.mjs';
import {prepareClient} from '../scripts/prepare-client.mjs';

test('every catalog preview produces a no-send client package with one form and private-only recipient',async()=>{
 const base=resolve(tmpdir()),output=await mkdtemp(join(base,'jb-catalog-test-'));
 try{
  assert.equal(new Set(sites.map(s=>s.id)).size,sites.length);
  for(const site of sites){
   const result=await prepareClient({site:site.id,domain:'client.example',recipient:'owner@example.com',sender:'forms@forms.client.example',mode:'preview'},output);
   const html=await readFile(join(result.directory,'public/index.html'),'utf8');
   const config=JSON.parse(await readFile(result.configPath,'utf8'));
   assert.equal((html.match(/<section[^>]*data-contact-form/g)||[]).length,1,site.id);
   assert.match(html,/data-contact-mode="preview"/);
   assert.match(html,/src="\/assets\/contact-form.js"/);
   assert.doesNotMatch(html,/owner@example.com/);
   assert.equal(config.vars.CONTACT_ENABLED,'false');
   assert.equal(config.vars.BUSINESS_NAME,site.name);
   assert.equal(config.send_email[0].destination_address,'owner@example.com');
  }
 }finally{
  assert.ok(resolve(output).startsWith(base+sep)&&output.includes('jb-catalog-test-'));
  await rm(output,{recursive:true,force:true});
 }
});
