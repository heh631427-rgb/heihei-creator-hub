import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@libsql/client';
import { adaptClient } from '../lib/database.mjs';
import { createTransferService, CHUNK_BYTES, BATCH_CHUNKS } from '../lib/transfer-core.mjs';
import { createAuthService, derivePasswordHash } from '../lib/auth-core.mjs';
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'heihei-migration-')),client=createClient({url:'file:'+join(dir,'test.db')});
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await client.executeMultiple(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 return {db:adaptClient(client),client,close(){client.close();rmSync(dir,{recursive:true,force:true});}};
}
const admin={username:'admin@example.test',role:'admin'},viewer={username:'viewer@example.test',role:'viewer'};
function parts(bytes){const result=[];for(let i=0;i<bytes.length;i+=CHUNK_BYTES)result.push(bytes.subarray(i,i+CHUNK_BYTES).toString('base64'));return result;}
test('actual libSQL adapter preserves auth, atomic rollback and session revocation',async()=>{
 const {db,client,close}=await setup();
 try{
  const salt=randomBytes(16).toString('base64url'),password='synthetic-password-for-test';
  const auth=createAuthService({db,sessionSecret:randomBytes(48).toString('base64url'),accountsJSON:JSON.stringify([{id:'test-admin',username:admin.username,role:'admin',salt,hash:await derivePasswordHash(password,salt)}])});
  const request=(path,method='GET',body,cookie)=>new Request('https://test.example'+path,{method,headers:{Origin:'https://test.example','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.22',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const logged=await auth.login(request('/api/auth/login','POST',{username:admin.username,password}));
  const cookie=logged.cookie.split(';')[0];assert.equal((await auth.requireUser(request('/api/state','GET',null,cookie))).role,'admin');
  await assert.rejects(db.batch([db.prepare("INSERT INTO auth_login_limits VALUES ('rollback',1,1)"),db.prepare('INSERT INTO table_that_does_not_exist VALUES (1)')]));
  assert.equal(await db.prepare("SELECT * FROM auth_login_limits WHERE bucket_key='rollback'").first(),null);
  const created=await auth.createAccount(request('/api/admin/accounts','POST',{username:'other@example.test',password:'another-synthetic-password',role:'viewer'},cookie));
  assert.equal(created.account.role,'viewer');
  await auth.updateAccount(request('/api/admin/accounts/test-admin','PATCH',{password:'new-synthetic-password'},cookie),'test-admin');
  assert.equal(await auth.currentUser(request('/api/state','GET',null,cookie)),null);
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM auth_sessions')).rows[0].n,0);
 }finally{close();}
});
test('24 MB transport stays below Vercel payload limit and is account-bound',async()=>{
 const {db,close}=await setup();
 try{
  const payload={state:{notes:'x'.repeat(24*1024*1024-1024)},revision:7};
  const service=createTransferService({db,readVisible:async()=>payload,save:async()=>{throw new Error('unused')}});
  const meta=await service.begin(admin,{direction:'download'});assert(meta.bytes>23*1024*1024);
  await assert.rejects(service.download(viewer,meta.id,0),e=>e.status===404);
  await assert.rejects(service.download({...admin,role:'viewer'},meta.id,0),e=>e.status===404);
  const out=[];
  for(let i=0;i<meta.chunks;i+=BATCH_CHUNKS){const r=await service.download(admin,meta.id,i);assert(Buffer.byteLength(JSON.stringify(r))<3*1024*1024);out.push(...r.chunks.map(s=>Buffer.from(s,'base64')));}
  assert.deepEqual(JSON.parse(Buffer.concat(out).toString()),payload);
  await service.remove(admin,meta.id);await assert.rejects(service.download(admin,meta.id,0),e=>e.status===404);
 }finally{close();}
});
test('upload enforces permissions, completeness, revision checks and replay receipt',async()=>{
 const {db,close}=await setup();
 try{
  let saved=0;const state={notes:'中文🙂'.repeat(300000)},bytes=Buffer.from(JSON.stringify(state)),chunks=parts(bytes);
  const service=createTransferService({db,readVisible:async()=>({}),save:async(value,revision)=>{assert.equal(revision,9);assert.deepEqual(value,state);saved++;return {revision:10,canUndo:true}}});
  await assert.rejects(service.begin(viewer,{direction:'upload',bytes:bytes.length,chunks:chunks.length,revision:9}),e=>e.status===403);
  const meta=await service.begin(admin,{direction:'upload',bytes:bytes.length,chunks:chunks.length,revision:9});
  await assert.rejects(service.commit(admin,meta.id),e=>e.status===400);assert.equal(saved,0);
  await assert.rejects(service.upload(admin,meta.id,0,['invalid']),e=>e.status===400);
  for(let i=0;i<chunks.length;i+=BATCH_CHUNKS){assert(Buffer.byteLength(JSON.stringify({start:i,chunks:chunks.slice(i,i+BATCH_CHUNKS)}))<3*1024*1024);await service.upload(admin,meta.id,i,chunks.slice(i,i+BATCH_CHUNKS));}
  assert.equal((await service.commit(admin,meta.id)).revision,10);
  assert.equal((await service.commit(admin,meta.id)).revision,10);assert.equal(saved,1);
  await assert.rejects(service.upload(admin,meta.id,0,[chunks[0]]),e=>e.status===409);
  await service.remove(admin,meta.id);
 }finally{close();}
});
test('stale business revision never reports successful transfer commit',async()=>{
 const {db,close}=await setup();try{
  const service=createTransferService({db,readVisible:async()=>({}),save:async()=>{const error=new Error('conflict');error.status=409;throw error;}});
  const bytes=Buffer.from('{}'),meta=await service.begin(admin,{direction:'upload',bytes:2,chunks:1,revision:1});
  await service.upload(admin,meta.id,0,parts(bytes));await assert.rejects(service.commit(admin,meta.id),e=>e.status===409);
  assert.equal((await db.prepare('SELECT status FROM transfer_jobs WHERE id=?').bind(meta.id).first()).status,'open');
 }finally{close();}
});
