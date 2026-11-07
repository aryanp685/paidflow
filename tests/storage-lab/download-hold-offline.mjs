// Synthetic tests: emulate the DB transaction/authorization boundary, not PostgreSQL RLS.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStorageLab} from '../../storage-lab/core.mjs';
import {legacyGrant} from './legacy-grant.mjs';

const actor=randomUUID(),id=randomUUID(),other=randomUUID(),sessionId='synthetic-session';
const secret='s'.repeat(32),now=1_800_000_000_000, headers=new Headers();
let currentSession={user:{id:actor,emailVerified:true},session:{id:sessionId}};
let state='structurally_valid_unscanned',denyLock=false,dbFailure=false,reads=0,locks=0;
const auth={api:{getSession:async()=>currentSession}};
const store={get:async()=>{reads++;throw Error('UNEXPECTED_STORE_READ');}};
const client={release(){},async query(sql,args){
  if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT')return {rows:[]};
  if(sql.includes('current_user AS role'))return {rows:[{role:'paidflow_runtime',restricted:true,not_owner:true,stale_actor:null}]};
  if(sql.includes("set_config('paidflow.actor_id'"))return {rows:[]};
  if(sql.includes('public.storage_lock')){locks++;if(dbFailure)throw Error('DB_FAILURE');if(denyLock||args[0]!==id)throw Error('FORBIDDEN');assert.equal(args[1],'read');return {rows:[{id,storage_status:state}]};}
  throw Error('Unexpected query: '+sql);
}};
const pool={connect:async()=>client};
const storage=createStorageLab({auth,runtimePool:pool,store,secret,clock:()=>now});
const make=(over={})=>legacyGrant({secret,id,sessionId,exp:now+30_000,...over});
let count=0;
async function test(name,fn){await fn();assert.equal(reads,0,'held operation accessed object storage');count++;console.log('PASS '+name);}
for(const s of ['quarantine','structurally_valid_unscanned','verified','revoked','deleting','deleted','abandoned','unknown_future_state']){
  await test(`${s}: no grants or bytes, including preview and old signed grant`,async()=>{
    state=s;await assert.rejects(()=>storage.grant({headers,id}),/NOT_AVAILABLE/);
    for(const preview of [false,true])await assert.rejects(()=>storage.download({headers,id,grant:make(),preview}),/NOT_AVAILABLE/);
  });
}
await test('authentication precedes database and grant validation',async()=>{
  const before=locks;for(const s of [null,{user:{id:actor,emailVerified:false},session:{id:sessionId}},{user:{id:actor,emailVerified:true},session:{}}]){currentSession=s;await assert.rejects(()=>storage.grant({headers,id}),/UNAUTHENTICATED/);await assert.rejects(()=>storage.download({headers,id,grant:make()}),/UNAUTHENTICATED/);}assert.equal(locks,before);currentSession={user:{id:actor,emailVerified:true},session:{id:sessionId}};
});
await test('forged, wrong-document, wrong-session, expired and future grants are rejected',async()=>{
  const before=locks;for(const grant of [undefined,'forged',make()+'x',make({id:other}),make({sessionId:'other'}),make({exp:now}),make({exp:now+60_001})])await assert.rejects(()=>storage.download({headers,id,grant}),/INVALID_GRANT/);assert.equal(locks,before);
});
await test('authorization failure and nonexistent id are not bypassed by hold',async()=>{
  denyLock=true;await assert.rejects(()=>storage.grant({headers,id}),/FORBIDDEN/);await assert.rejects(()=>storage.download({headers,id,grant:make()}),/FORBIDDEN/);denyLock=false;await assert.rejects(()=>storage.grant({headers,id:other}),/FORBIDDEN/);await assert.rejects(()=>storage.grant({headers,id:'bad'}),/FORBIDDEN/);
});
await test('database errors fail closed',async()=>{dbFailure=true;await assert.rejects(()=>storage.grant({headers,id}),/DB_FAILURE/);await assert.rejects(()=>storage.download({headers,id,grant:make()}),/DB_FAILURE/);dbFailure=false;});
console.log(`${count} synthetic hold checks passed; no scanner or real database exercised.`);
