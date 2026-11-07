import {legacyGrant} from './legacy-grant.mjs';
import pg from 'pg';import assert from 'node:assert/strict';import { startPrivateEmulator } from '../../storage-lab/emulator.mjs';import sharp from 'sharp';import {Readable} from 'node:stream';import { PDFDocument } from 'pdf-lib';import { randomBytes,randomUUID } from 'node:crypto';import { readFile,readdir,mkdtemp,rm } from 'node:fs/promises';import { withActorTransaction } from '../../neon/runtime/with-actor.mjs';import { createLabAuth,createInitialBusiness } from '../../better-auth-lab/core.mjs';import { createLocalS3 } from '../../storage-lab/s3.mjs';import { createStorageLab,MAX_BYTES } from '../../storage-lab/core.mjs';
const source=process.env.PAIDFLOW_STORAGE_TEST_DATABASE_URL;if(!source||!process.argv.includes('--standalone'))throw Error('Use a fresh disposable local cluster and --standalone');const uri=new URL(source);if(uri.search||uri.hash||!['127.0.0.1','localhost','::1','[::1]'].includes(uri.hostname))throw Error('No remote database or tunnel');
const {Client,Pool}=pg,admin=new Client({connectionString:source}),dbname=`paidflow_storage_${process.pid}_${Date.now()}`,dburl=new URL(uri);dburl.pathname=`/${dbname}`;const roleUrl=name=>{let u=new URL(dburl);u.username=name;u.password='';return u.toString();};let db,authPool,runtimePool,emulator,dir,store,storage,roles=[],madeDb=false,passed=0,failed=0,now=Date.now();const accessKeyId=randomBytes(16).toString('hex'),secretAccessKey=randomBytes(32).toString('hex'),emulatorToken=randomBytes(32).toString('hex');const q=(c,s,p=[])=>c.query(s,p);const files=async d=>(await readdir(d)).filter(n=>n.endsWith('.sql')).sort();async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
const grantSecret=randomBytes(32).toString('base64url');
let auth,cookieA,cookieB,idA,idB,businessA,businessB,doc,proof,ocr;
const oldGrant=async(cookie,id)=>legacyGrant({secret:grantSecret,id,sessionId:(await auth.api.getSession({headers:headers(cookie)})).session.id,exp:now+60000});const messages=[];const origin='http://localhost:3000',pw=randomBytes(24).toString('base64url');
const request=async(path,body)=>auth.handler(new Request(`${origin}/api/better-auth-lab${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
async function makeUser(email){await request('/sign-up/email',{name:'Synthetic',email,password:pw,callbackURL:origin});const msg=messages.find(m=>m.email===email&&m.kind==='verify');await auth.handler(new Request(msg.url));const r=await request('/sign-in/email',{email,password:pw});assert.equal(r.status,200);return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
const headers=cookie=>new Headers({cookie});const setup=(cookie,name)=>createInitialBusiness({auth,runtimePool,headers:headers(cookie),key:randomUUID(),input:{name,businessType:'other',address:'Synthetic street',city:'Pune',district:'Pune',stateCode:'27',pincode:'411001',gstRegistered:false,invoicePrefix:'PF',termsDays:15}});
const runUpload=(cookie,businessId,area='evidence',over={})=>storage.upload({headers:headers(cookie),businessId,area,name:'example.png',declared:'image/png',requestId:randomUUID(),bytes:png,...over});let png,pdf;
try{
  await admin.connect();if((await q(admin,"select 1 from pg_roles where rolname=any($1)",[['paidflow_runtime','paidflow_migrator','paidflow_auth_service']])).rowCount)throw Error('Existing roles; use fresh cluster');
  for(const [n,o] of [['paidflow_runtime','LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'],['paidflow_migrator','NOLOGIN BYPASSRLS'],['paidflow_auth_service','LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS']]){await q(admin,`create role ${n} ${o}`);roles.push(n);}await q(admin,`create database "${dbname}" owner paidflow_migrator`);madeDb=true;db=new Client({connectionString:dburl.toString()});await db.connect();await q(db,'set role paidflow_migrator');for(const folder of ['neon/migrations','better-auth-lab/migrations','storage-lab/migrations'])for(const f of await files(folder))await q(db,await readFile(`${folder}/${f}`,'utf8'));await q(db,'reset role');
  authPool=new Pool({connectionString:roleUrl('paidflow_auth_service')});runtimePool=new Pool({connectionString:roleUrl('paidflow_runtime'),max:8});auth=createLabAuth({authPool,baseURL:origin,secret:randomBytes(32).toString('base64url'),mail:async m=>messages.push(m)});
  dir=await mkdtemp('/tmp/paidflow-storage-emulator-');emulator=await startPrivateEmulator({directory:dir,accessKeyId,secretAccessKey,token:emulatorToken});const {port}=emulator;store=createLocalS3({endpoint:`http://127.0.0.1:${port}`,accessKeyId,secretAccessKey,emulatorToken});await store.assertPrivate();storage=createStorageLab({auth,runtimePool,store,secret:grantSecret,clock:()=>now});
  png=await sharp({create:{width:4,height:4,channels:3,background:'#aabbcc'}}).png().toBuffer();const pdfDoc=await PDFDocument.create();pdfDoc.addPage();pdf=Buffer.from(await pdfDoc.save());
  await test('anonymous and forged-token emulator access denied',async()=>{assert.equal((await fetch(`http://127.0.0.1:${port}/evidence`)).status,403);assert.equal((await fetch(`http://127.0.0.1:${port}/evidence`,{headers:{'x-paidflow-emulator-token':randomBytes(32).toString('hex')}})).status,403);assert.equal((await fetch(`http://127.0.0.1:${port}/evidence`,{method:'POST',headers:{'x-paidflow-emulator-token':emulatorToken}})).status,403);});
  await test('guarded emulator rejects bucket mutation, subresources, unscoped listing and chunked or oversized PUT',async()=>{const base=`http://127.0.0.1:${port}`,h={'x-paidflow-emulator-token':emulatorToken},object=`/evidence/${randomUUID()}/${randomUUID()}`;for(const [method,path] of [['PUT','/evidence'],['DELETE','/evidence'],['PUT','/evidence?cors'],['GET','/evidence?list-type=2'],['GET',`${object}?acl`],['GET','/evidence/arbitrary-key']]){const r=await fetch(base+path,{method,headers:h,...(method==='PUT'?{body:Buffer.from('x')}:{})});assert.equal(r.status,403);}const chunked=await fetch(base+object,{method:'PUT',headers:h,body:Readable.from([Buffer.from('synthetic')]),duplex:'half'});assert.equal(chunked.status,411);const oversized=await fetch(base+object,{method:'PUT',headers:h,body:Buffer.alloc(MAX_BYTES+1)});assert.equal(oversized.status,413);});
  await test('real Better Auth users and two businesses',async()=>{cookieA=await makeUser('a@example.invalid');cookieB=await makeUser('b@example.invalid');idA=(await auth.api.getSession({headers:headers(cookieA)})).user.id;idB=(await auth.api.getSession({headers:headers(cookieB)})).user.id;businessA=await setup(cookieA,'Synthetic A');businessB=await setup(cookieB,'Synthetic B');assert.notEqual(businessA,businessB);});
  await test('valid upload registers, structurally checks and stores unscanned object',async()=>{doc=await runUpload(cookieA,businessA);assert.equal(doc.status,'structurally_valid_unscanned');const r=await q(db,'select * from public.documents where id=$1',[doc.id]);assert.equal(r.rows[0].storage_area,'evidence');assert.notEqual(r.rows[0].storage_path,doc.name);assert.ok((await store.get('evidence',r.rows[0].storage_path,MAX_BYTES)).equals(png));});
  await test('payment-proof and OCR staging areas supported',async()=>{proof=await runUpload(cookieA,businessA,'payment-proofs');ocr=await runUpload(cookieA,businessA,'ocr-staging',{name:'document.pdf',declared:'application/pdf',bytes:pdf});assert.equal(proof.status,'structurally_valid_unscanned');assert.equal(ocr.status,'structurally_valid_unscanned');});
  await test('JPEG content is decoded and remains unscanned',async()=>{const jpeg=await sharp({create:{width:4,height:4,channels:3,background:'#aabbcc'}}).jpeg().toBuffer();const d=await runUpload(cookieA,businessA,'evidence',{name:'photo.jpg',declared:'image/jpeg',bytes:jpeg});assert.equal(d.status,'structurally_valid_unscanned');});
  await test('17 application tables and extraction schema remain present',async()=>{const r=await q(db,"select count(*)::int n from information_schema.tables where table_schema='public' and table_name not in ('user','session','account','verification') and table_type='BASE TABLE'");assert.equal(r.rows[0].n,17);assert.equal((await q(db,"select count(*)::int n from information_schema.tables where table_schema='public' and table_name='document_extractions'")).rows[0].n,1);});
  await test('unscanned download and preview are denied even with an old valid grant',async()=>{const g=await oldGrant(cookieA,doc.id);await assert.rejects(()=>storage.grant({headers:headers(cookieA),id:doc.id}),/NOT_AVAILABLE/);for(const preview of [false,true])await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:g,preview}),/NOT_AVAILABLE/);await assert.rejects(()=>storage.download({headers:headers(cookieA),id:proof.id,grant:g}),/INVALID_GRANT/);});
  await test('authenticated access denials persist separately without target or token leakage',async()=>{
    const before=(await q(db,'select coalesce(max(id),0) n from paidflow_private.storage_access_denials')).rows[0].n;
    const token=await oldGrant(cookieA,doc.id);
    await assert.rejects(()=>storage.grant({headers:headers(cookieA),id:doc.id}),/NOT_AVAILABLE/);
    await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:token,preview:true}),/NOT_AVAILABLE/);
    await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:'synthetic-forgery'}),/INVALID_GRANT/);
    await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:doc.id}));
    const rows=(await q(db,'select actor_user_id,operation,to_jsonb(x) event from paidflow_private.storage_access_denials x where id>$1 order by id',[before])).rows;
    assert.deepEqual(rows.map(x=>[x.actor_user_id,x.operation]),[[idA,'grant'],[idA,'preview'],[idA,'download'],[idB,'grant']]);
    for(const r of rows)for(const secret of [token,'synthetic-forgery',cookieA])assert.ok(!JSON.stringify(r.event).includes(secret));
    assert.equal(rows[0].event.business_id,businessA);assert.equal(rows[0].event.document_id,doc.id);
    assert.equal(rows[1].event.business_id,businessA);assert.equal(rows[1].event.document_id,doc.id);
    for(const r of rows.slice(2)){assert.equal(r.event.business_id,null);assert.equal(r.event.document_id,null);}
    await assert.rejects(()=>q(runtimePool,'select * from paidflow_private.storage_access_denials'),e=>e.code==='42501');
    await assert.rejects(()=>q(runtimePool,"delete from paidflow_private.storage_access_denials"),e=>e.code==='42501');
    await assert.rejects(()=>withActorTransaction(runtimePool,idA,c=>q(c,"select public.storage_record_access_denial('scan')")),e=>e.code==='22023');
  });
  await test('denied upload and delete plus anonymous requests are persisted without tenant identifiers',async()=>{
    const before=(await q(db,'select coalesce(max(id),0) n from paidflow_private.storage_access_denials')).rows[0].n;
    await assert.rejects(()=>runUpload(cookieB,businessA));
    await assert.rejects(()=>storage.remove({headers:headers(cookieB),id:doc.id}));
    await assert.rejects(()=>storage.grant({headers:new Headers(),id:doc.id}),/UNAUTHENTICATED/);
    await storage.recordRequestDenial({headers:headers(cookieA),operation:'upload',reason:'origin'});
    await storage.recordRequestDenial({headers:headers(cookieA),operation:'upload',reason:'validation'});
    const rows=(await q(db,'select actor_user_id,operation,reason,to_jsonb(x) event from paidflow_private.storage_access_denials x where id>$1 order by id',[before])).rows;
    assert.deepEqual(rows.map(({actor_user_id,operation,reason})=>[actor_user_id,operation,reason]),[[idB,'upload','access'],[idB,'delete','access'],[null,'grant','unauthenticated'],[null,'upload','origin'],[idA,'upload','validation']]);
    for(const row of rows)for(const secret of [businessA,businessB,doc.id,cookieA,cookieB,'example.png'])assert.ok(!JSON.stringify(row.event).includes(secret));
    await assert.rejects(()=>q(runtimePool,'update paidflow_private.storage_access_denials set operation=$1',['upload']),e=>e.code==='42501');
    await assert.rejects(()=>q(runtimePool,'truncate paidflow_private.storage_access_denials'),e=>e.code==='42501');
    await assert.rejects(()=>q(runtimePool,"select public.storage_record_anonymous_denial('scan','origin')"),e=>e.code==='22023');
  });
  await test('concurrent denials persist independently and neither tenant can read events',async()=>{
    const before=(await q(db,'select coalesce(max(id),0) n from paidflow_private.storage_access_denials')).rows[0].n;
    const attempts=await Promise.allSettled(Array.from({length:8},()=>storage.grant({headers:headers(cookieA),id:doc.id})));
    assert.ok(attempts.every(x=>x.status==='rejected'));
    assert.equal((await q(db,"select count(*)::int n from paidflow_private.storage_access_denials where id>$1 and actor_user_id=$2 and operation='grant'",[before,idA])).rows[0].n,8);
    for(const actor of [idA,idB])await assert.rejects(()=>withActorTransaction(runtimePool,actor,c=>q(c,'select * from paidflow_private.storage_access_denials')),e=>e.code==='42501');
    await withActorTransaction(runtimePool,idA,c=>q(c,"select public.storage_record_anonymous_denial('grant','origin')"));
    const last=(await q(db,'select actor_user_id,reason from paidflow_private.storage_access_denials order by id desc limit 1')).rows[0];
    assert.deepEqual(last,{actor_user_id:null,reason:'origin'});
  });
  await test('audit outage never authorizes denied upload or delete',async()=>{
    await q(db,'revoke execute on function public.storage_record_access_denial(text,text) from paidflow_runtime');
    let puts=0,deletes=0;const put=store.put,del=store.delete;
    store.put=async(...args)=>{puts++;return put(...args);};store.delete=async(...args)=>{deletes++;return del(...args);};
    try{await assert.rejects(()=>runUpload(cookieB,businessA));await assert.rejects(()=>storage.remove({headers:headers(cookieB),id:doc.id}));assert.equal(puts,0);assert.equal(deletes,0);}
    finally{store.put=put;store.delete=del;await q(db,'grant execute on function public.storage_record_access_denial(text,text) to paidflow_runtime');}
  });
  await test('auth outage is anonymous and anonymous-audit outage stays denied',async()=>{
    const unavailable=createStorageLab({auth:{api:{getSession:async()=>{throw Error('synthetic auth outage');}}},runtimePool,store,secret:grantSecret});
    await assert.rejects(()=>unavailable.grant({headers:headers(cookieA),id:doc.id}),/synthetic auth outage/);
    assert.deepEqual((await q(db,'select actor_user_id,operation,reason from paidflow_private.storage_access_denials order by id desc limit 1')).rows[0],{actor_user_id:null,operation:'grant',reason:'auth_unavailable'});
    await q(db,'revoke execute on function public.storage_record_anonymous_denial(text,text) from paidflow_runtime');
    try{await assert.rejects(()=>storage.download({headers:new Headers(),id:doc.id,grant:'fake'}));}
    finally{await q(db,'grant execute on function public.storage_record_anonymous_denial(text,text) to paidflow_runtime');}
  });
  await test('audit outage never permits a held download',async()=>{
    const token=await oldGrant(cookieA,doc.id),get=store.get;let reads=0;
    store.get=async(...args)=>{reads++;return get(...args);};
    await q(db,'revoke execute on function public.storage_record_context_denial(text,text,uuid,uuid) from paidflow_runtime');
    try {await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:token}),e=>e.code==='42501');assert.equal(reads,0);}
    finally {store.get=get;await q(db,'grant execute on function public.storage_record_context_denial(text,text,uuid,uuid) to paidflow_runtime');}
  });
  await test('only verified target denials appear in tenant-scoped security view',async()=>{
    const before=(await q(db,'select coalesce(max(id),0) n from paidflow_private.storage_access_denials')).rows[0].n;
    const token=await oldGrant(cookieA,doc.id);
    await assert.rejects(()=>storage.grant({headers:headers(cookieA),id:doc.id}),/NOT_AVAILABLE/);
    await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:token,preview:true}),/NOT_AVAILABLE/);
    await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{declared:'text/html'}),/INVALID_TYPE/);
    await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:doc.id}));
    await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:'synthetic-forgery'}));
    await storage.recordRequestDenial({headers:headers(cookieA),operation:'grant',reason:'origin'});
    const rows=(await q(db,'select actor_user_id,operation,business_id,document_id from paidflow_private.storage_access_denials where id>$1 order by id',[before])).rows;
    assert.deepEqual(rows.map(r=>[r.actor_user_id,r.operation,r.business_id,r.document_id]),[
      [idA,'grant',businessA,doc.id],[idA,'preview',businessA,doc.id],[idA,'upload',businessA,null],
      [idB,'grant',null,null],[idA,'download',null,null],[null,'grant',null,null],
    ]);
    const visible=await storage.tenantDenials({headers:headers(cookieA),businessId:businessA});
    assert.ok(visible.events.some(e=>e.documentId===doc.id&&e.operation==='grant'));
    assert.ok(visible.events.some(e=>e.documentId===null&&e.operation==='upload'));
    assert.ok(!visible.events.some(e=>e.actorId===idB));
    for(const value of [token,'synthetic-forgery',cookieA,'example.png',businessB])assert.ok(!JSON.stringify(visible).includes(value));
    await assert.rejects(()=>storage.tenantDenials({headers:headers(cookieB),businessId:businessA}),e=>e.code==='42501');
    await assert.rejects(()=>storage.tenantDenials({headers:new Headers(),businessId:businessA}),/UNAUTHENTICATED/);
    await assert.rejects(()=>q(runtimePool,'select * from paidflow_private.storage_access_denials'),e=>e.code==='42501');
  });
  await test('tenant security view is bounded, and cross-tenant context is stripped',async()=>{
    await withActorTransaction(runtimePool,idA,c=>q(c,"select public.storage_record_context_denial('upload','access',$1,null)",[businessB]));
    assert.deepEqual((await q(db,'select business_id,document_id from paidflow_private.storage_access_denials order by id desc limit 1')).rows[0],{business_id:null,document_id:null});
    await q(db,"insert into paidflow_private.storage_access_denials(actor_user_id,operation,reason,business_id) select $1,'upload','validation',$2 from generate_series(1,101)",[idB,businessB]);
    const view=await storage.tenantDenials({headers:headers(cookieB),businessId:businessB});assert.equal(view.events.length,100);assert.equal(view.hasMore,true);
    assert.ok(view.events.every(e=>e.actorId===idB&&e.documentId===null));
  });
  await test('permission changes during audit insertion strip target identifiers',async()=>{
    await q(db,"update public.business_members set status='suspended' where business_id=$1 and user_id=$2",[businessA,idA]);
    try{await withActorTransaction(runtimePool,idA,c=>q(c,"select public.storage_record_context_denial('grant','access',null,$1)",[doc.id]));
      const row=(await q(db,'select business_id,document_id from paidflow_private.storage_access_denials order by id desc limit 1')).rows[0];assert.deepEqual(row,{business_id:null,document_id:null});
    }finally{await q(db,"update public.business_members set status='active' where business_id=$1 and user_id=$2",[businessA,idA]);}
  });
  await test('audit outage on an authorized upload denial fails closed',async()=>{
    const original=store.put;let writes=0;store.put=async(...args)=>{writes++;return original(...args);};
    await q(db,'revoke execute on function public.storage_record_context_denial(text,text,uuid,uuid) from paidflow_runtime');
    try{await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{declared:'text/html'}),e=>e.code==='42501');assert.equal(writes,0);}
    finally{store.put=original;await q(db,'grant execute on function public.storage_record_context_denial(text,text,uuid,uuid) to paidflow_runtime');}
  });
  await test('unapproved MIME, spoofed signature and corrupt content denied',async()=>{await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{declared:'text/html'}),/INVALID_TYPE/);await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{bytes:Buffer.from('<html>bad</html>')}),/INVALID_TYPE/);await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{bytes:Buffer.concat([png.subarray(0,8),Buffer.from('broken')])}),/INVALID_CONTENT/);await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{bytes:Buffer.from('%PDF-1.7\nfake\n%%EOF'),declared:'application/pdf'}),/INVALID_CONTENT/);});
  await test('empty and oversized payloads denied',async()=>{await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{bytes:Buffer.alloc(0)}),/INVALID_SIZE/);await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{bytes:Buffer.alloc(MAX_BYTES+1)}),/INVALID_SIZE/);});
  await test('filename sanitized and object key generated by server',async()=>{const d=await runUpload(cookieA,businessA,'evidence',{name:'../../invoice\u202e<script>.png'});assert.ok(!/[\\/<>\u202e]/.test(d.name));const row=(await q(db,'select storage_path from public.documents where id=$1',[d.id])).rows[0];assert.match(row.storage_path,new RegExp(`^${businessA}/[0-9a-f-]{36}$`));});
  await test('owner history is tenant-bound, projected, and excludes arbitrary event metadata',async()=>{
    const bd=await runUpload(cookieB,businessB),secret='synthetic-secret-cookie-token-url-filename';
    await q(db,"insert into public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action,metadata) values($1,$2,'document',$3,'document.registered',jsonb_build_object('untrusted',$4::text))",[businessA,idA,doc.id,secret]);
    const a=await storage.history({headers:headers(cookieA),businessId:businessA});const b=await storage.history({headers:headers(cookieB),businessId:businessB});
    assert.ok(a.events.some(e=>e.documentId===doc.id));assert.ok(b.events.some(e=>e.documentId===bd.id));
    assert.ok(!a.events.some(e=>e.documentId===bd.id));assert.ok(!b.events.some(e=>e.documentId===doc.id));
    assert.ok(!JSON.stringify(a).includes(secret));assert.ok(!JSON.stringify(a).includes('example.png'));assert.ok(a.events.every(e=>Object.keys(e).sort().join(',')==='action,actorId,documentId,id,occurredAt'));
    await assert.rejects(()=>storage.history({headers:headers(cookieB),businessId:businessA}),e=>e.code==='42501');
    await assert.rejects(()=>storage.history({headers:new Headers(),businessId:businessA}),/UNAUTHENTICATED/);
    await assert.rejects(()=>storage.history({headers:headers(cookieA),businessId:'invalid'}),/FORBIDDEN/);
  });
  await test('history limits disclosure and indicates truncation',async()=>{
    await q(db,"insert into public.activity_logs(business_id,actor_user_id,entity_type,entity_id,action) select $1,$2,'document',$3,'document.registered' from generate_series(1,101)",[businessB,idB,randomUUID()]);
    const h=await storage.history({headers:headers(cookieB),businessId:businessB});assert.equal(h.events.length,100);assert.equal(h.hasMore,true);
  });
  await test('history reader transaction serializes with suspension and then denies suspended access',async()=>{
    let ready,release;const started=new Promise(r=>{ready=r}),gate=new Promise(r=>{release=r});let changed=false,change;
    const worker=withActorTransaction(runtimePool,idA,async c=>{await q(c,'select * from public.storage_document_history($1)',[businessA]);await q(c,'select * from public.storage_tenant_denials($1)',[businessA]);ready();await gate;});
    try{await started;change=q(db,"update public.business_members set status='suspended' where business_id=$1 and user_id=$2",[businessA,idA]).then(()=>{changed=true;});await new Promise(r=>setTimeout(r,100));assert.equal(changed,false);release();await worker;await change;await assert.rejects(()=>storage.history({headers:headers(cookieA),businessId:businessA}),e=>e.code==='42501');}
    finally{release();await worker.catch(()=>{});if(change)await change.catch(()=>{});await q(db,"update public.business_members set status='active' where business_id=$1 and user_id=$2",[businessA,idA]);}
  });
  await test('cross-tenant upload, grant and deletion denied',async()=>{await assert.rejects(()=>runUpload(cookieB,businessA),/FORBIDDEN/);await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:doc.id}));await assert.rejects(()=>storage.remove({headers:headers(cookieB),id:doc.id}));});
  await test('viewer can only read evidence, cannot access proofs/OCR or upload/delete',async()=>{await q(db,"insert into public.business_members(business_id,user_id,role) values($1,$2,'viewer')",[businessA,idB]);const visible=await storage.list({headers:headers(cookieB),businessId:businessA});assert.ok(visible.some(d=>d.id===doc.id));assert.ok(!visible.some(d=>d.id===proof.id||d.id===ocr.id));await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:doc.id}),/NOT_AVAILABLE/);await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:proof.id}));await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:ocr.id}));await assert.rejects(()=>runUpload(cookieB,businessA));await assert.rejects(()=>storage.remove({headers:headers(cookieB),id:doc.id}));});
  await test('history is restricted to active owner or admin, not viewer',async()=>{
    await assert.rejects(()=>storage.history({headers:headers(cookieB),businessId:businessA}),e=>e.code==='42501');
    await assert.rejects(()=>storage.tenantDenials({headers:headers(cookieB),businessId:businessA}),e=>e.code==='42501');
    await q(db,"update public.business_members set role='admin' where business_id=$1 and user_id=$2",[businessA,idB]);
    try{assert.ok((await storage.history({headers:headers(cookieB),businessId:businessA})).events.some(e=>e.documentId===doc.id));assert.ok((await storage.tenantDenials({headers:headers(cookieB),businessId:businessA})).events.length>0);}
    finally{await q(db,"update public.business_members set role='viewer' where business_id=$1 and user_id=$2",[businessA,idB]);}
  });
  await test('viewer cannot use another session grant or clean storage',async()=>{const g=await oldGrant(cookieA,doc.id);await assert.rejects(()=>storage.download({headers:headers(cookieB),id:doc.id,grant:g}),/INVALID_GRANT/);await assert.rejects(()=>storage.cleanup({headers:headers(cookieB),businessId:businessA}));});
  await test('accountant and manager have area-specific permissions',async()=>{await q(db,"update public.business_members set role='accountant' where business_id=$1 and user_id=$2",[businessA,idB]);await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:proof.id}),/NOT_AVAILABLE/);await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:ocr.id}));await q(db,"update public.business_members set role='manager' where business_id=$1 and user_id=$2",[businessA,idB]);await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:ocr.id}),/NOT_AVAILABLE/);await assert.rejects(()=>storage.remove({headers:headers(cookieB),id:doc.id}));await q(db,"update public.business_members set role='viewer' where business_id=$1 and user_id=$2",[businessA,idB]);});
  await test('suspension revokes previously issued grant immediately',async()=>{const g=await oldGrant(cookieB,doc.id);await q(db,"update public.business_members set status='suspended' where business_id=$1 and user_id=$2",[businessA,idB]);await assert.rejects(()=>storage.download({headers:headers(cookieB),id:doc.id,grant:g}));await assert.rejects(()=>storage.grant({headers:headers(cookieB),id:doc.id}));await q(db,"update public.business_members set status='active' where business_id=$1 and user_id=$2",[businessA,idB]);});
  await test('expired and tampered download grants fail',async()=>{const g=await oldGrant(cookieA,doc.id);await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:g+'x'}),/INVALID_GRANT/);now+=61_000;await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:g}),/INVALID_GRANT/);now=Date.now();});
  await test('concurrent idempotent retry writes one document and one upload event',async()=>{const requestId=randomUUID();const [a,b]=await Promise.all([runUpload(cookieA,businessA,'evidence',{requestId}),runUpload(cookieA,businessA,'evidence',{requestId})]);assert.equal(a.id,b.id);const row=(await q(db,"select count(*)::int n from public.activity_logs where entity_id=$1 and action='document.uploaded'",[a.id])).rows[0];assert.equal(row.n,1);await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{requestId,name:'different.png'}));});
  await test('upload/storage failure leaves quarantine and retry finalizes once',async()=>{const requestId=randomUUID();const original=store.get;let once=true;store.get=async(...args)=>{if(once){once=false;throw Error('injected storage failure');}return original(...args);};try{await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{requestId}));}finally{store.get=original;}const row=(await q(db,'select * from public.documents where storage_request_id=$1',[requestId])).rows[0];assert.equal(row.storage_status,'quarantine');assert.equal((await q(db,"select count(*)::int n from public.activity_logs where entity_id=$1 and action='document.uploaded'",[row.id])).rows[0].n,0);const retry=await runUpload(cookieA,businessA,'evidence',{requestId});assert.equal(retry.id,row.id);assert.equal(retry.status,'structurally_valid_unscanned');});
  await test('tampered stored object is not served',async()=>{const row=(await q(db,'select * from public.documents where id=$1',[doc.id])).rows[0];await store.put(row.storage_area,row.storage_path,Buffer.from('tampered'),'image/png');const g=await oldGrant(cookieA,doc.id);await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:g}),/NOT_AVAILABLE/);await store.put(row.storage_area,row.storage_path,png,'image/png');});
  await test('stale quarantine and unknown orphan cleaned without touching unscanned files',async()=>{const requestId=randomUUID();const original=store.get;store.get=async()=>{throw Error('injected');};try{await assert.rejects(()=>runUpload(cookieA,businessA,'evidence',{requestId}));}finally{store.get=original;}const stale=(await q(db,'select * from public.documents where storage_request_id=$1',[requestId])).rows[0];await q(db,"update public.documents set storage_expires_at=now()-interval '1 second' where id=$1",[stale.id]);const orphan=`${businessA}/${randomUUID()}`;await store.put('evidence',orphan,png,'image/png');const out=await storage.cleanup({headers:headers(cookieA),businessId:businessA});assert.ok(out.cleaned>=2);assert.equal((await q(db,'select storage_status from public.documents where id=$1',[stale.id])).rows[0].storage_status,'abandoned');await assert.rejects(()=>store.get('evidence',stale.storage_path,MAX_BYTES));await assert.rejects(()=>store.get('evidence',orphan,MAX_BYTES));const row=(await q(db,'select storage_area,storage_path from public.documents where id=$1',[doc.id])).rows[0];assert.ok((await store.get(row.storage_area,row.storage_path,MAX_BYTES)).equals(png));await assert.rejects(()=>storage.grant({headers:headers(cookieA),id:doc.id}),/NOT_AVAILABLE/);});
  await test('failed deletion remains inaccessible and retry completes once',async()=>{const d=await runUpload(cookieA,businessA);const original=store.delete;store.delete=async()=>{throw Error('injected delete failure');};try{await assert.rejects(()=>storage.remove({headers:headers(cookieA),id:d.id}));}finally{store.delete=original;}assert.equal((await q(db,'select storage_status from public.documents where id=$1',[d.id])).rows[0].storage_status,'deleting');await assert.rejects(()=>storage.grant({headers:headers(cookieA),id:d.id}));assert.equal((await q(db,"select count(*)::int n from public.activity_logs where entity_id=$1 and action='document.deleted'",[d.id])).rows[0].n,0);await storage.remove({headers:headers(cookieA),id:d.id});assert.equal((await q(db,"select count(*)::int n from public.activity_logs where entity_id=$1 and action='document.deleted'",[d.id])).rows[0].n,1);});
  await test('audit events record registration, structural upload and successful delete',async()=>{const row=(await q(db,"select * from public.documents where id=$1",[proof.id])).rows[0];const events=(await q(db,'select action,actor_user_id,metadata from public.activity_logs where entity_id=$1 order by created_at',[proof.id])).rows;assert.deepEqual(events.map(e=>e.action),['document.registered','document.uploaded']);assert.equal(events[1].actor_user_id,idA);assert.equal(events[1].metadata.area,'payment-proofs');assert.ok(!JSON.stringify(events).includes(row.storage_path));await storage.remove({headers:headers(cookieA),id:proof.id});await assert.rejects(()=>store.get(row.storage_area,row.storage_path,MAX_BYTES));const deleted=(await q(db,"select action,actor_user_id from public.activity_logs where entity_id=$1 and action='document.deleted'",[proof.id])).rows;assert.equal(deleted.length,1);assert.equal(deleted[0].actor_user_id,idA);await assert.rejects(()=>storage.grant({headers:headers(cookieA),id:proof.id}));});
  await test('financial ledger remains consistent and linked proof deletion is blocked',async()=>{
    const customer=randomUUID(),invoice=randomUUID(),key=randomUUID();const linked=await runUpload(cookieA,businessA,'payment-proofs');
    await q(db,"insert into public.customers(id,business_id,name,created_by) values($1,$2,'Synthetic buyer',$3)",[customer,businessA,idA]);
    await q(db,"insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,'SYNTHETIC-1','2026-04-01','2026-04-16',2026,'27','27',1000,1000,1000,1000,$4)",[invoice,businessA,customer,idA]);
    await withActorTransaction(runtimePool,idA,async c=>{await q(c,"insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,line_total_paise) values($1,$2,'Synthetic',1,1000,1000,1000)",[businessA,invoice]);await q(c,'select public.issue_invoice($1,$2)',[businessA,invoice]);});
    // Privileged fixture simulates a future scanner result; no scanner exists in the lab.
    await q(db,"update public.documents set customer_id=$1,invoice_id=$2,storage_status='verified' where id=$3",[customer,invoice,linked.id]);
    const first=(await withActorTransaction(runtimePool,idA,c=>q(c,"select public.record_payment($1,$2,$3,200,'2026-05-01','upi',null,$4,null) as result",[businessA,invoice,key,linked.id]))).rows[0].result;assert.equal(first.invoice.paid_paise,200);assert.equal(first.invoice.balance_paise,800);
    const retry=(await withActorTransaction(runtimePool,idA,c=>q(c,"select public.record_payment($1,$2,$3,200,'2026-05-01','upi',null,$4,null) as result",[businessA,invoice,key,linked.id]))).rows[0].result;assert.equal(retry.replayed,true);
    await assert.rejects(()=>storage.remove({headers:headers(cookieA),id:linked.id}));const deny=(await q(db,'select business_id,document_id,operation from paidflow_private.storage_access_denials order by id desc limit 1')).rows[0];assert.deepEqual(deny,{business_id:businessA,document_id:linked.id,operation:'delete'});const row=(await q(db,'select paid_paise,balance_paise from public.invoices where id=$1',[invoice])).rows[0];assert.deepEqual(row,{paid_paise:'200',balance_paise:'800'});assert.equal((await q(db,'select storage_status from public.documents where id=$1',[linked.id])).rows[0].storage_status,'verified');
  });
  await test('runtime cannot mutate document metadata directly',async()=>{await assert.rejects(()=>q(runtimePool,"update public.documents set storage_status='verified'"),e=>e.code==='42501');await assert.rejects(()=>q(runtimePool,"insert into public.documents(business_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,'other','x','x','image/png',1)",[businessA]),e=>e.code==='42501');});
  await test('expired Better Auth session cannot download, even with grant',async()=>{const g=await oldGrant(cookieA,doc.id);await q(db,'update public."session" set "expiresAt"=now()-interval \'1 second\' where "userId"=$1',[idA]);await assert.rejects(()=>storage.download({headers:headers(cookieA),id:doc.id,grant:g}),/UNAUTHENTICATED/);await assert.rejects(()=>storage.history({headers:headers(cookieA),businessId:businessA}),/UNAUTHENTICATED/);await assert.rejects(()=>storage.tenantDenials({headers:headers(cookieA),businessId:businessA}),/UNAUTHENTICATED/);const r=(await q(db,'select actor_user_id,operation,reason from paidflow_private.storage_access_denials order by id desc limit 1')).rows[0];assert.deepEqual(r,{actor_user_id:null,operation:'download',reason:'unauthenticated'});});
}finally{if(store)store.close();if(emulator)await emulator.close();if(dir)await rm(dir,{recursive:true,force:true});if(runtimePool)await runtimePool.end();if(authPool)await authPool.end();if(db)await db.end();if(madeDb)await q(admin,`drop database "${dbname}" with (force)`);for(const r of roles.reverse())await q(admin,`drop role ${r}`);await admin.end();}
console.log(`\n${passed} passed; ${failed} failed. Local Better Auth + PostgreSQL + S3 emulator.`);if(failed)process.exitCode=1;
