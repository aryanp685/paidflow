import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const { Client } = pg;
// Refuse non-loopback targets. --standalone creates/drops a uniquely named disposable database.
const base = process.env.PAIDFLOW_TEST_DATABASE_URL;
if (!base) throw new Error('Set PAIDFLOW_TEST_DATABASE_URL to a disposable local PostgreSQL administrator connection; see docs/database-testing.md');
const url = new URL(base);
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) throw new Error('Refusing non-loopback database URL');
if (!process.argv.includes('--standalone')) throw new Error('This test runner requires --standalone and creates a disposable database; see documentation. It does not modify existing databases.');
const dbname = `paidflow_test_${process.pid}_${Date.now()}`;
const admin = new Client({ connectionString: base }); await admin.connect();
await admin.query(`CREATE DATABASE "${dbname}"`);
const dburl = new URL(base); dburl.pathname = `/${dbname}`;
const db = new Client({ connectionString: dburl.toString() });
let failures = 0, passed = 0, knownGaps = 0;
const ids = { ownerA:'10000000-0000-4000-8000-000000000001', ownerB:'10000000-0000-4000-8000-000000000002', admin:'10000000-0000-4000-8000-000000000011', manager:'10000000-0000-4000-8000-000000000003', viewer:'10000000-0000-4000-8000-000000000004', accountant:'10000000-0000-4000-8000-000000000005', suspended:'10000000-0000-4000-8000-000000000006', bootstrap:'10000000-0000-4000-8000-000000000007', fresh:'10000000-0000-4000-8000-000000000008', rollback:'10000000-0000-4000-8000-000000000009', unverified:'10000000-0000-4000-8000-000000000010', a:'20000000-0000-4000-8000-000000000001', b:'20000000-0000-4000-8000-000000000002', ca:'30000000-0000-4000-8000-000000000001', cb:'30000000-0000-4000-8000-000000000002', ia:'40000000-0000-4000-8000-000000000001', ib:'40000000-0000-4000-8000-000000000002', doc:'50000000-0000-4000-8000-000000000002' };
async function as(user, fn, client = db) { await client.query('SET ROLE authenticated'); await client.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,role:'authenticated'})]); try { return await fn(client); } finally { await client.query('RESET ROLE'); await client.query("SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','',false)"); } }
async function test(name, fn) { try { await fn(); if (name.startsWith('KNOWN GAP:')) { knownGaps++; console.log(`VULNERABILITY DEMONSTRATED (not a security pass): ${name}`); } else { passed++; console.log(`PASS ${name}`); } } catch (e) { failures++; console.error(`FAIL ${name}:`,e.message); } }
async function fails(fn, codes) { try { await fn(); assert.fail('Expected operation to fail'); } catch(e) { if (e.code === 'ERR_ASSERTION') throw e; if (codes) assert.ok(codes.includes(e.code), `unexpected code ${e.code}: ${e.message}`); } }
const issue = (c, b, i) => c.query('select public.issue_invoice($1,$2)',[b,i]);
const payment = (c,b,i,key,amount) => c.query("select public.record_payment($1,$2,$3,$4,'2026-05-01','upi') as result", [b,i,key,amount]);
try {
  await db.connect();
  await db.query(await readFile('tests/database/bootstrap-standalone.sql','utf8'));
  // Apply the deny migration later, after reproducing the legacy baseline and
  // creating a historical proof-bearing payment for upgrade testing.
  const denyMigration = '20261107000700_deny_payment_proof_attachment.sql';
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql') && n <= '20261107000600_auth_onboarding.sql').sort()) { await db.query(await readFile(`supabase/migrations/${name}`,'utf8')); console.log(`MIGRATION ${name}`); }
  await db.query(await readFile('tests/database/supabase-rls.sql','utf8'));
  console.log('PASS transactional SQL RLS suite against mock auth');
  for (const user of ['ownerA','ownerB','admin','manager','viewer','accountant','suspended','bootstrap','fresh','rollback','unverified']) await db.query('insert into auth.users(id,email,aud,role) values($1,$2,$3,$3)',[ids[user],`${user}@example.invalid`,'authenticated']);
  await db.query("insert into public.businesses(id,name,state_code,created_by) values ($1,'Fictional A','27',$3),($2,'Fictional B','27',$4)",[ids.a,ids.b,ids.ownerA,ids.ownerB]);
  for(const [b,u,role,status] of [[ids.a,ids.ownerA,'owner','active'],[ids.b,ids.ownerB,'owner','active'],[ids.a,ids.admin,'admin','active'],[ids.a,ids.manager,'manager','active'],[ids.a,ids.viewer,'viewer','active'],[ids.a,ids.accountant,'accountant','active'],[ids.a,ids.suspended,'manager','suspended']]) await db.query('insert into public.business_members(business_id,user_id,role,status) values($1,$2,$3,$4)',[b,u,role,status]);
  await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Fictional A buyer',$3),($4,$5,'Fictional B buyer',$6)",[ids.ca,ids.a,ids.ownerA,ids.cb,ids.b,ids.ownerB]);
  for (const [i,b,c,u] of [[ids.ia,ids.a,ids.ca,ids.ownerA],[ids.ib,ids.b,ids.cb,ids.ownerB]]) {
    await db.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,'EXAMPLE-1','2026-04-01','2026-04-16',2026,'27','27',1000,1000,1000,1000,$4)",[i,b,c,u]);
    await db.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,line_total_paise) values($1,$2,'Fictional work',1,1000,1000,1000)",[b,i]);
    await as(u,c => issue(c,b,i));
  }
  await db.query("insert into public.documents(id,business_id,customer_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes,uploaded_by) values($1,$2,$3,$4,'other','demo.txt',$5,'text/plain',1,$6)",[ids.doc,ids.b,ids.cb,ids.ib,`${ids.b}/demo.txt`,ids.ownerB]);
  await as(ids.ownerB, c => payment(c,ids.b,ids.ib,randomUUID(),100));
  // SECURITY GAP regression: this proves base migrations accept unscanned
  // metadata-only proof. It is not a passing proof-security acceptance test.
  await test('KNOWN GAP: base Supabase schema accepts same-invoice proof without a scan',async()=>{
    const columns=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='documents' and column_name in ('storage_status','scan_status')")).rows;
    assert.equal(columns.length,0);
    const doc=randomUUID(),key=randomUUID();await db.query('BEGIN');
    try { await as(ids.manager,async c=>{
      await c.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,'other','unscanned.txt',$4,'text/plain',1)",[doc,ids.a,ids.ia,`${ids.a}/${doc}`]);
      const r=(await c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4) result",[ids.a,ids.ia,key,doc])).rows[0].result;
      assert.equal(r.payment.proof_document_id,doc);assert.equal(r.payment.verification_status,'proof_attached');
    }); } finally { await db.query('ROLLBACK'); }
    assert.equal((await db.query('select count(*)::int n from public.payments where idempotency_key=$1',[key])).rows[0].n,0);
  });
  await test('KNOWN GAP: accountant can attach previously registered metadata-only proof',async()=>{
    const doc=randomUUID(),key=randomUUID();await db.query('BEGIN');
    try {
      await as(ids.manager,c=>c.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,'other','unscanned.txt',$4,'text/plain',1)",[doc,ids.a,ids.ia,`${ids.a}/${doc}`]));
      await as(ids.accountant,async c=>{
        const r=(await c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4) result",[ids.a,ids.ia,key,doc])).rows[0].result;
        assert.equal(r.payment.proof_document_id,doc);assert.equal(r.payment.recorded_by,ids.accountant);
      });
    } finally { await db.query('ROLLBACK'); }
    assert.equal((await db.query('select count(*)::int n from public.payments where idempotency_key=$1',[key])).rows[0].n,0);
  });
  await test('KNOWN GAP: document associated with an earlier same-invoice payment can be reused as another proof',async()=>{
    const doc=randomUUID(),keyA=randomUUID(),keyB=randomUUID();await db.query('BEGIN');
    try { await as(ids.manager,async c=>{
      const a=(await c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi') result",[ids.a,ids.ia,keyA])).rows[0].result.payment;
      await c.query("insert into public.documents(id,business_id,invoice_id,payment_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,$4,'other','unscanned.txt',$5,'text/plain',1)",[doc,ids.a,ids.ia,a.id,`${ids.a}/${doc}`]);
      const b=(await c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4) result",[ids.a,ids.ia,keyB,doc])).rows[0].result.payment;
      assert.notEqual(a.id,b.id);assert.equal(b.proof_document_id,doc);
    }); } finally { await db.query('ROLLBACK'); }
    assert.equal((await db.query('select count(*)::int n from public.payments where idempotency_key=any($1::uuid[])',[[keyA,keyB]])).rows[0].n,0);
  });
  await test('base Supabase runtime privileges expose record_payment to authenticated role only',async()=>{
    const r=(await db.query("select has_function_privilege('authenticated','public.record_payment(uuid,uuid,uuid,bigint,date,text,text,uuid,text)','EXECUTE') authenticated,has_function_privilege('anon','public.record_payment(uuid,uuid,uuid,bigint,date,text,text,uuid,text)','EXECUTE') anon,has_table_privilege('authenticated','public.payments','INSERT') payment_insert,has_table_privilege('authenticated','public.documents','INSERT') document_insert")).rows[0];
    assert.deepEqual(r,{authenticated:true,anon:false,payment_insert:false,document_insert:true});
  });
  await test('base Supabase composite FK rejects missing, cross-tenant and different-invoice proofs',async()=>{
    const otherInvoice=randomUUID(),doc=randomUUID();
    await db.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,created_by) values($1,$2,$3,'OTHER-PROOF','2026-04-01','2026-04-16',2026,'27','27',$4)",[otherInvoice,ids.a,ids.ca,ids.ownerA]);
    await db.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes,uploaded_by) values($1,$2,$3,'other','fake.txt',$4,'text/plain',1,$5)",[doc,ids.a,otherInvoice,`${ids.a}/${doc}`,ids.ownerA]);
    const snapshot=async()=>((await db.query("select (select count(*)::int from public.payments where invoice_id=$1) payments,(select count(*)::int from public.activity_logs where business_id=$2 and action='payment.recorded') audits,(select balance_paise from public.invoices where id=$1) balance",[ids.ia,ids.a])).rows[0]);
    const before=await snapshot();
    await as(ids.manager,async c=>{for(const target of [ids.doc,doc,randomUUID()])await fails(()=>c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4)",[ids.a,ids.ia,randomUUID(),target]),['23503']);});
    assert.deepEqual(await snapshot(),before);
  });
  await test('customer RLS allows manager create/edit but isolates another tenant',async()=>{
    const id=randomUUID();await db.query('BEGIN');
    try {
      await as(ids.manager,async c=>{
        await c.query("insert into public.customers(id,business_id,name,email) values($1,$2,'Synthetic customer','buyer@example.invalid')",[id,ids.a]);
        const own=await c.query("update public.customers set name='Updated customer' where business_id=$1 and id=$2 returning name",[ids.a,id]);assert.equal(own.rows[0].name,'Updated customer');
        const cross=await c.query("update public.customers set name='Not allowed' where business_id=$1 and id=$2 returning id",[ids.b,ids.cb]);assert.equal(cross.rowCount,0);
      });
      assert.equal((await db.query('select name from public.customers where id=$1',[ids.cb])).rows[0].name,'Fictional B buyer');
    } finally { await db.query('ROLLBACK'); }
  });
  await test('customer RLS prevents viewer/accountant writes',async()=>{
    for(const user of [ids.viewer,ids.accountant]) await as(user,async c=>{
      await fails(()=>c.query("insert into public.customers(business_id,name) values($1,'Denied')",[ids.a]),['42501']);
      const r=await c.query("update public.customers set name='Denied' where id=$1 returning id",[ids.ca]);assert.equal(r.rowCount,0);
    });
    assert.equal((await db.query('select name from public.customers where id=$1',[ids.ca])).rows[0].name,'Fictional A buyer');
  });
  await test('A: user A cannot read B customers, but sees A', () => as(ids.ownerA, async c => { assert.equal((await c.query('select id from public.customers where business_id=$1',[ids.b])).rowCount,0); assert.equal((await c.query('select id from public.customers where business_id=$1',[ids.a])).rowCount,1); }));
  await test('B: user A cannot read B invoices', () => as(ids.ownerA, async c => assert.equal((await c.query('select id from public.invoices where business_id=$1',[ids.b])).rowCount,0)));
  await test('C: user A cannot read B payments', () => as(ids.ownerA, async c => assert.equal((await c.query('select id from public.payments where business_id=$1',[ids.b])).rowCount,0)));
  await test('D: user A cannot read B document metadata', () => as(ids.ownerA, async c => assert.equal((await c.query('select id from public.documents where business_id=$1',[ids.b])).rowCount,0)));
  await test('E: manager cannot promote themselves through direct DML or RPC', () => as(ids.manager, async c => { await fails(()=>c.query("update public.business_members set role='owner' where business_id=$1 and user_id=$2",[ids.a,ids.manager]),['42501']); await fails(()=>c.query("select public.set_member_access($1,$2,'owner','active')",[ids.a,ids.manager]),['42501']); }));
  await test('F: viewer cannot insert customer, invoice, or record payment', () => as(ids.viewer, async c => { await fails(()=>c.query("insert into public.customers(business_id,name) values($1,'No')",[ids.a]),['42501']); await fails(()=>c.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code) values($1,$2,'NO','2026-04-01','2026-04-02',2026,'27','27')",[ids.a,ids.ca]),['42501']); await fails(()=>payment(c,ids.a,ids.ia,randomUUID(),1),['42501']); }));
  await test('G: cross-tenant customer reference rejected by composite FK', () => as(ids.manager, async c => fails(()=>c.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code) values($1,$2,'CROSS','2026-04-01','2026-04-02',2026,'27','27')",[ids.a,ids.cb]),['23503'])));
  await test('H: cross-tenant payment cannot be recorded via RPC or table', () => as(ids.manager, async c => { await fails(()=>payment(c,ids.a,ids.ib,randomUUID(),1),['P0002']); await fails(()=>c.query("insert into public.payments(business_id,invoice_id,customer_id,payment_date,amount_paise,payment_mode,idempotency_key,recorded_by) values($1,$2,$3,current_date,1,'upi',$4,$5)",[ids.a,ids.ib,ids.cb,randomUUID(),ids.manager]),['42501']); }));
  await test('H structural: privileged insert still cannot cross invoice/customer tenants', async () => fails(()=>db.query("insert into public.payments(business_id,invoice_id,customer_id,payment_date,amount_paise,payment_mode,idempotency_key,recorded_by) values($1,$2,$3,current_date,1,'upi',$4,$5)",[ids.a,ids.ib,ids.cb,randomUUID(),ids.ownerA]),['23503']));
  await test('I: unauthenticated cannot execute privileged RPC', async () => { await db.query('SET ROLE anon'); try { await fails(()=>payment(db,ids.a,ids.ia,randomUUID(),1),['42501']); await fails(()=>db.query("select public.create_business('No','27')"),['42501']); } finally { await db.query('RESET ROLE'); } });
  await test('J: suspended user cannot access tenant or mutate via RPC', () => as(ids.suspended, async c => { assert.equal((await c.query('select * from public.customers where business_id=$1',[ids.a])).rowCount,0); await fails(()=>payment(c,ids.a,ids.ia,randomUUID(),1),['42501']); }));
  await test('documents cannot reference another tenant customer', () => as(ids.manager, async c => fails(()=>c.query("insert into public.documents(business_id,customer_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,'other','x',$3,'text/plain',1)",[ids.a,ids.cb,`${ids.a}/x`]),['23503'])));
  await test('owner can suspend and restore a manager', async () => { await as(ids.ownerA, c => c.query("select public.set_member_access($1,$2,'manager','suspended')",[ids.a,ids.manager])); await as(ids.manager, async c => { assert.equal((await c.query('select * from public.invoices where business_id=$1',[ids.a])).rowCount,0); }); await as(ids.ownerA, c => c.query("select public.set_member_access($1,$2,'manager','active')",[ids.a,ids.manager])); });
  await test('owner cannot self-demote, admin cannot be minted by manager', () => as(ids.ownerA, async c => fails(()=>c.query("select public.set_member_access($1,$2,'viewer','active')",[ids.a,ids.ownerA]),['42501'])));
  await test('privileged balance and issued invoice updates denied', () => as(ids.manager, async c => { await fails(()=>c.query('update public.invoices set paid_paise=0 where id=$1',[ids.ia]),['42501']); assert.equal((await c.query("update public.invoices set notes='x' where id=$1",[ids.ia])).rowCount,0); await fails(()=>c.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,line_total_paise) values($1,$2,'x',1,1,1,1)",[ids.a,ids.ia]),['42501','P0001']); }));
  await test('invoice arithmetic, GST and quantity invalid values rejected', async () => { await fails(()=>db.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,total_paise,balance_paise,created_by) values($1,$2,'BAD','2026-04-01','2026-04-02',2026,'27','27',100,0,$3)",[ids.a,ids.ca,ids.ownerA]),['23514']); await fails(()=>db.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,is_gst_invoice,supply_type,cgst_paise,igst_paise,total_paise,balance_paise,created_by) values($1,$2,'BADGST','2026-04-01','2026-04-02',2026,'27','27',true,'intra_state',1,1,2,2,$3)",[ids.a,ids.ca,ids.ownerA]),['23514']); });
  await test('owner bootstrap is atomic; audit logs cannot be forged or edited', () => as(ids.bootstrap, async c => { const r=await c.query("select public.onboard_business(gen_random_uuid(),'Fictional New',null,'other','1 Fictional Road','Pune','Pune','27','411001',false,null,null,'PF',15) as id"); assert.equal((await c.query('select role from public.business_members where business_id=$1',[r.rows[0].id])).rows[0].role,'owner'); await fails(()=>c.query("insert into public.activity_logs(business_id,entity_type,entity_id,action) values($1,'x',$2,'x')",[ids.a,ids.ia]),['42501']); await fails(()=>c.query('delete from public.activity_logs where business_id=$1',[ids.a]),['42501']); }));
  await test('accountant records partial payment, retry is idempotent; mismatch and overpayment rejected', () => as(ids.accountant, async c => { const key=randomUUID(); const r=(await payment(c,ids.a,ids.ia,key,300)).rows[0].result; assert.equal(r.invoice.balance_paise,700); const retry=(await payment(c,ids.a,ids.ia,key,300)).rows[0].result; assert.equal(retry.replayed,true); assert.equal(retry.payment.id,r.payment.id); await fails(()=>payment(c,ids.a,ids.ia,key,301),['22023']); await fails(()=>payment(c,ids.a,ids.ia,randomUUID(),701),['22023']); }));
  await test('owner can void a payment; voided amount no longer counts', () => as(ids.ownerA, async c => { const p=(await c.query('select id from public.payments where invoice_id=$1 and status=\'recorded\'',[ids.ia])).rows[0].id; const r=(await c.query("select public.void_payment($1,$2,'Correction') as result",[ids.a,p])).rows[0].result; assert.equal(r.invoice.balance_paise,1000); assert.equal(r.payment.status,'voided'); assert.equal((await c.query("select count(*)::int n from public.activity_logs where business_id=$1 and action='payment.voided'",[ids.a])).rows[0].n,1); }));
  await test('FY boundaries and concurrent allocations have no duplicates', async () => { const before=await as(ids.manager, c => c.query("select public.allocate_invoice_number($1,'2026-03-31') n",[ids.a])); assert.match(before.rows[0].n,/2025-26/); const connections=await Promise.all(Array.from({length:12},async()=>{const c=new Client({connectionString:dburl.toString()}); await c.connect(); return c;})); try { const nums=await Promise.all(connections.map(c=>as(ids.manager,async cl=>(await cl.query("select public.allocate_invoice_number($1,'2026-04-01') n",[ids.a])).rows[0].n,c))); assert.equal(new Set(nums).size,12); assert.ok(nums.every(n=>n.includes('2026-27'))); } finally { await Promise.all(connections.map(c=>c.end())); } });
  await test('concurrent payments cannot overpay', async () => { const connections=await Promise.all([0,1].map(async()=>{ const c=new Client({connectionString:dburl.toString()});await c.connect();return c; })); try { const results=await Promise.allSettled(connections.map(c=>as(ids.manager,cl=>payment(cl,ids.a,ids.ia,randomUUID(),700),c))); assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(results.filter(r=>r.status==='rejected').length,1); const invoice=(await db.query('select paid_paise,balance_paise from public.invoices where id=$1',[ids.ia])).rows[0]; assert.equal(invoice.paid_paise,'700');assert.equal(invoice.balance_paise,'300'); } finally { await Promise.all(connections.map(c=>c.end())); } });
  await test('deferred constraint rejects even privileged ledger drift', async () => { await fails(() => db.query("insert into public.payments(business_id,invoice_id,customer_id,payment_date,amount_paise,payment_mode,idempotency_key,recorded_by) values($1,$2,$3,current_date,1,'cash',$4,$5)",[ids.a,ids.ia,ids.ca,randomUUID(),ids.ownerA]),['23514']); assert.equal((await db.query("select count(*)::int n from public.payments where invoice_id=$1 and amount_paise=1",[ids.ia])).rows[0].n,0); });
  await test('KNOWN GAP: same-invoice payment receipt metadata is accepted without verification', () => as(ids.manager, async c => { await fails(()=>c.query("select public.record_payment($1,$2,$3,100,'2026-05-01','upi',null,$4)",[ids.a,ids.ia,randomUUID(),ids.doc]),['23503']); const doc=randomUUID(); await c.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,'payment_receipt','example.png',$4,'image/png',1)",[doc,ids.a,ids.ia,`${ids.a}/${doc}`]); const r=(await c.query("select public.record_payment($1,$2,$3,100,'2026-05-01','upi',null,$4) as result",[ids.a,ids.ia,randomUUID(),doc])).rows[0].result; assert.equal(r.payment.verification_status,'proof_attached'); }));
  await test('invoice issuance validates line GST distribution and totals', async () => { await as(ids.ownerA, c => c.query("update public.businesses set is_gst_registered=true,gstin='27ABCDE1234F1Z5' where id=$1",[ids.a])); await as(ids.manager, async c => { const invoice=randomUUID(); await c.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,is_gst_invoice,supply_type,subtotal_paise,taxable_paise,cgst_paise,sgst_paise,total_paise,balance_paise) values($1,$2,$3,'GSTTEST','2026-04-01','2026-04-02',2026,'27','27',true,'intra_state',100,100,9,9,118,118)",[invoice,ids.a,ids.ca]); const line=randomUUID(); await c.query("insert into public.invoice_items(id,business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,gst_rate_bps,igst_paise,line_total_paise) values($1,$2,$3,'Test',1,100,100,1800,18,118)",[line,ids.a,invoice]); await fails(()=>issue(c,ids.a,invoice),['P0001']); await c.query('update public.invoice_items set igst_paise=0,cgst_paise=9,sgst_paise=9 where id=$1',[line]); await issue(c,ids.a,invoice); assert.equal((await c.query('select lifecycle_status from public.invoices where id=$1',[invoice])).rows[0].lifecycle_status,'issued'); }); });
  await test('invitation creation respects roles and never reveals token hashes', async () => { await as(ids.manager, c => fails(()=>c.query("select public.create_business_invitation($1,'a@example.invalid','viewer',$2,now() + interval '1 day')",[ids.a,'a'.repeat(64)]),['42501'])); await as(ids.ownerA, async c => { await c.query("select public.create_business_invitation($1,'a@example.invalid','manager',$2,now() + interval '1 day')",[ids.a,'b'.repeat(64)]); assert.equal((await c.query('select id,email from public.business_invitations where business_id=$1',[ids.a])).rowCount,1); await fails(()=>c.query('select token_hash from public.business_invitations where business_id=$1',[ids.a]),['42501']); }); });
  await test('membership suspension waits for an authorized RPC transaction', async () => { const worker=new Client({connectionString:dburl.toString()}); const owner=new Client({connectionString:dburl.toString()}); await worker.connect(); await owner.connect(); try { await worker.query('BEGIN'); await as(ids.manager, c => c.query("select public.allocate_invoice_number($1,'2026-05-01')",[ids.a]),worker); let finished=false; const suspend=as(ids.ownerA,c=>c.query("select public.set_member_access($1,$2,'manager','suspended')",[ids.a,ids.manager]),owner).then(()=>{finished=true;}); await new Promise(resolve=>setTimeout(resolve,100)); assert.equal(finished,false,'suspension should wait for membership lock'); await worker.query('COMMIT'); await suspend; await as(ids.manager,c=>fails(()=>c.query("select public.allocate_invoice_number($1,'2026-05-01')",[ids.a]),['42501']),worker); await as(ids.ownerA,c=>c.query("select public.set_member_access($1,$2,'manager','active')",[ids.a,ids.manager]),owner); } finally { await worker.query('ROLLBACK').catch(()=>{}); await worker.end(); await owner.end(); } });
  const onboard = (c,key,name='Onboarding Test') => c.query("select public.onboard_business($1,$2,null,'other','1 Fictional Road','Pune','Pune','27','411001',true,null,null,'PF',15) as id",[key,name]);
  await test('new auth users get a self-only profile and unverified users cannot onboard', async () => { assert.equal((await db.query('select count(*)::int n from public.profiles where id=$1',[ids.unverified])).rows[0].n,1); await db.query('update auth.users set email_confirmed_at=null where id=$1',[ids.unverified]); await as(ids.unverified, c=>fails(()=>onboard(c,randomUUID()),['42501'])); await as(ids.ownerA,async c=>assert.equal((await c.query('select id from public.profiles where id=$1',[ids.ownerB])).rowCount,0)); });
  await test('concurrent onboarding is idempotent and creates owner, defaults and audit once', async () => { const key=randomUUID(); const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()}); await c.connect(); return c;})); try { const rows=await Promise.all(clients.map(c=>as(ids.fresh,cl=>onboard(cl,key),c))); const id=rows[0].rows[0].id; assert.equal(rows[1].rows[0].id,id); const r=await db.query("select (select count(*)::int from public.business_members where business_id=$1 and user_id=$2 and role='owner') members,(select count(*)::int from public.subscriptions where business_id=$1) subs,(select count(*)::int from public.notification_preferences where business_id=$1) prefs,(select count(*)::int from public.activity_logs where business_id=$1 and action='business.created') logs,(select default_business_id from public.profiles where id=$2) default_id",[id,ids.fresh]); assert.deepEqual(r.rows[0],{members:1,subs:1,prefs:1,logs:1,default_id:id}); await as(ids.fresh,async c=>{await fails(()=>onboard(c,key,'Different'),['22023']); await fails(()=>onboard(c,randomUUID()),['23505']); await fails(()=>c.query('select public.set_default_business($1)',[ids.b]),['42501']); await fails(()=>c.query('update public.profiles set default_business_id=$1 where id=$2',[ids.b,ids.fresh]),['42501']);}); } finally { await Promise.all(clients.map(c=>c.end())); } });
  await test('failure after business insert rolls back business, membership, defaults and audit', async () => { await db.query("create function public.test_abort_onboarding() returns trigger language plpgsql as $$ begin raise exception 'Injected failure'; end $$; create trigger test_abort before insert on public.notification_preferences for each row execute function public.test_abort_onboarding()"); try { await as(ids.rollback,c=>fails(()=>onboard(c,randomUUID()),['P0001'])); assert.equal((await db.query('select count(*)::int n from public.businesses where created_by=$1',[ids.rollback])).rows[0].n,0); assert.equal((await db.query('select count(*)::int n from public.business_members where user_id=$1',[ids.rollback])).rows[0].n,0); assert.equal((await db.query('select default_business_id from public.profiles where id=$1',[ids.rollback])).rows[0].default_business_id,null); } finally { await db.query('drop trigger test_abort on public.notification_preferences; drop function public.test_abort_onboarding()'); } });
  await test('demo seed refuses without opt-in and is repeatable with explicit opt-in', async () => { const seed=await readFile('supabase/seed.sql','utf8'); await fails(()=>db.query(seed)); await db.query("select set_config('paidflow.allow_demo_seed','local-only',false)"); await db.query(seed); await db.query(seed); assert.equal((await db.query("select count(*)::int n from public.businesses where id='de000000-0000-4000-8000-000000000002'")).rows[0].n,1); });
  // Exercise the actual candidate migration against the legacy synthetic state
  // after retaining the baseline observations above. Never applied to hosted Supabase.
  const history=(await db.query("select * from public.payments where business_id=$1 and proof_document_id is not null limit 1",[ids.a])).rows[0];
  assert.ok(history,'a legacy proof-bearing payment is required for upgrade tests');
  const historyBefore=JSON.stringify(history);
  // Legacy reverse association exists before the hold. Preserve it rather than
  // rewriting financial evidence during migration.
  const legacyLinked=randomUUID();
  await as(ids.manager,c=>c.query("insert into public.documents(id,business_id,invoice_id,payment_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,$4,'payment_receipt','legacy.txt',$5,'text/plain',1)",[legacyLinked,ids.a,ids.ia,history.id,`${ids.a}/${legacyLinked}`]));
  const legacyLinkedBefore=(await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0];
  const forwardLinkedBefore=(await db.query('select * from public.documents where id=$1',[history.proof_document_id])).rows[0];
  const invoiceBefore=(await db.query('select * from public.invoices where id=$1',[ids.ia])).rows[0];
  const oldAudit=await db.query("select * from public.activity_logs where business_id=$1 order by id",[ids.a]);
  await db.query(await readFile(`supabase/migrations/${denyMigration}`,'utf8'));
  const ledger=async()=> (await db.query("select (select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where business_id=$1) payments,(select to_jsonb(i) from public.invoices i where id=$2) invoice,(select jsonb_agg(to_jsonb(a) order by a.id) from public.activity_logs a where business_id=$1) audit",[ids.a,ids.ia])).rows[0];
  await test('local hold upgrade preserves historical proof, invoice and audit',async()=>{
    assert.equal(JSON.stringify((await db.query('select * from public.payments where id=$1',[history.id])).rows[0]),historyBefore);
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0],legacyLinkedBefore);
    assert.deepEqual((await db.query('select * from public.invoices where id=$1',[ids.ia])).rows[0],invoiceBefore);
    assert.deepEqual((await db.query("select * from public.activity_logs where business_id=$1 order by id",[ids.a])).rows,oldAudit.rows);
  });
  const proofCall=(c,userDoc,invoice=ids.ia,key=randomUUID())=>c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4)",[ids.a,invoice,key,userDoc]);
  const addInvoiceOnlyDocument=async(category='other')=>{
    const id=randomUUID();
    await as(ids.manager,c=>c.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,$4,'metadata-only.txt',$5,'text/plain',1)",[id,ids.a,ids.ia,category,`${ids.a}/${id}`]));
    return id;
  };
  await test('candidate attack 1: manager cannot attach same-invoice unscanned metadata',async()=>{
    const doc=await addInvoiceOnlyDocument(), before=await ledger();
    await as(ids.manager,c=>fails(()=>proofCall(c,doc),['23514']));
    assert.deepEqual(await ledger(),before);
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0],legacyLinkedBefore);
    assert.equal(JSON.stringify((await db.query('select * from public.payments where id=$1',[history.id])).rows[0]),historyBefore);
  });
  await test('candidate attack 2: accountant cannot attach manager-registered metadata-only proof',async()=>{
    const doc=await addInvoiceOnlyDocument(), before=await ledger();
    await as(ids.accountant,c=>fails(()=>proofCall(c,doc),['23514']));
    assert.deepEqual(await ledger(),before);
    assert.equal(JSON.stringify((await db.query('select * from public.payments where id=$1',[history.id])).rows[0]),historyBefore);
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0],legacyLinkedBefore);
  });
  await test('candidate attack 3: same-invoice document linked to an earlier payment cannot be reused',async()=>{
    const doc=(await db.query('select payment_id,invoice_id from public.documents where id=$1',[legacyLinked])).rows[0];
    assert.equal(doc.payment_id,history.id);assert.equal(doc.invoice_id,ids.ia);
    const before=await ledger();
    await as(ids.manager,c=>fails(()=>proofCall(c,legacyLinked),['23514']));
    assert.deepEqual(await ledger(),before);
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0],legacyLinkedBefore);
    assert.equal(JSON.stringify((await db.query('select * from public.payments where id=$1',[history.id])).rows[0]),historyBefore);
  });
  await test('candidate attack 4: same-invoice receipt metadata without verification cannot be attached',async()=>{
    const doc=await addInvoiceOnlyDocument('payment_receipt'), before=await ledger();
    await as(ids.manager,c=>fails(()=>proofCall(c,doc),['23514']));
    assert.deepEqual(await ledger(),before);
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0],legacyLinkedBefore);
    assert.equal(JSON.stringify((await db.query('select * from public.payments where id=$1',[history.id])).rows[0]),historyBefore);
  });
  await test('candidate proof hold role, tenant, invoice, missing metadata and concurrent-consumption matrix',async()=>{
    const doc=await addInvoiceOnlyDocument(), before=await ledger();
    for(const user of [ids.ownerA,ids.admin,ids.manager,ids.accountant]) await as(user,c=>fails(()=>proofCall(c,doc),['23514']));
    await as(ids.viewer,c=>fails(()=>proofCall(c,doc),['42501']));
    await as(ids.ownerB,c=>fails(()=>proofCall(c,doc),['42501']));
    await db.query('SET ROLE anon');
    try {await fails(()=>proofCall(db,doc),['42501']);} finally {await db.query('RESET ROLE');}
    await as(ids.manager,async c=>{
      await fails(()=>proofCall(c,randomUUID()),['23514']);
      await fails(()=>proofCall(c,ids.doc),['23514']);
      const other=(await c.query("select id from public.invoices where business_id=$1 and invoice_number='GSTTEST'",[ids.a])).rows[0];
      await fails(()=>proofCall(c,doc,other.id),['23514']);
    });
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {await Promise.all(clients.map(c=>as(ids.manager,x=>fails(()=>proofCall(x,doc),['23514']),c)));}
    finally {await Promise.all(clients.map(c=>c.end()));}
    assert.deepEqual(await ledger(),before);
    assert.equal(JSON.stringify((await db.query('select * from public.payments where id=$1',[history.id])).rows[0]),historyBefore);
  });
  await test('local hold blocks manager and accountant metadata-only proofs through direct RPC',async()=>{
    const doc=randomUUID();await as(ids.manager,c=>c.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,'other','unscanned.txt',$4,'text/plain',1)",[doc,ids.a,ids.ia,`${ids.a}/${doc}`]));
    const before=await ledger();
    for(const user of [ids.ownerA,ids.manager,ids.accountant]) await as(user,c=>fails(()=>c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4)",[ids.a,ids.ia,randomUUID(),doc]),['23514']));
    assert.deepEqual(await ledger(),before);
  });
  await test('local hold blocks same-invoice unscanned receipt metadata for all payment writers',async()=>{
    const doc=randomUUID();
    await as(ids.manager,c=>c.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,'payment_receipt','unscanned-receipt.png',$4,'image/png',1)",[doc,ids.a,ids.ia,`${ids.a}/${doc}`]));
    const before=await ledger();
    for(const user of [ids.ownerA,ids.manager,ids.accountant]) await as(user,c=>fails(()=>c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4)",[ids.a,ids.ia,randomUUID(),doc]),['23514']));
    assert.deepEqual(await ledger(),before);
  });
  await test('local hold blocks missing, cross-tenant, wrong-invoice and legacy proof IDs with unchanged ledger',async()=>{
    const doc=randomUUID(); await as(ids.manager,c=>c.query("insert into public.documents(id,business_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,'other','x',$3,'text/plain',1)",[doc,ids.a,`${ids.a}/${doc}`]));
    const other=(await db.query('select id from public.documents where business_id=$1 and invoice_id is not null and invoice_id<>$2 limit 1',[ids.a,ids.ia])).rows[0];assert.ok(other);
    const before=await ledger();
    for(const target of [randomUUID(),ids.doc,doc,other.id,legacyLinked,history.proof_document_id]) await as(ids.manager,c=>fails(()=>c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4)",[ids.a,ids.ia,randomUUID(),target]),['23514']));
    assert.deepEqual(await ledger(),before);
  });
  await test('local hold blocks reverse document-to-payment association and preserves historical links',async()=>{
    const doc=randomUUID();
    await as(ids.manager,c=>c.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,'other','x',$4,'text/plain',1)",[doc,ids.a,ids.ia,`${ids.a}/${doc}`]));
    const before=await ledger();
    for(const user of [ids.ownerA,ids.manager]) {
      const id=randomUUID();
      await as(user,c=>fails(()=>c.query("insert into public.documents(id,business_id,invoice_id,payment_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,$4,'payment_receipt','unscanned.txt',$5,'text/plain',1)",[id,ids.a,ids.ia,history.id,`${ids.a}/${id}`]),['23514']));
      assert.equal((await db.query('select count(*)::int n from public.documents where id=$1',[id])).rows[0].n,0);
    }
    await as(ids.ownerB,c=>fails(()=>c.query("insert into public.documents(id,business_id,invoice_id,payment_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,$4,'other','x',$5,'text/plain',1)",[randomUUID(),ids.b,ids.ib,history.id,`${ids.b}/${randomUUID()}`]),['23514']));
    await as(ids.accountant,async c=>{
      // BEFORE trigger runs before RLS WITH CHECK for the linked insert.
      await fails(()=>c.query("insert into public.documents(id,business_id,invoice_id,payment_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,$4,'other','x',$5,'text/plain',1)",[randomUUID(),ids.a,ids.ia,history.id,`${ids.a}/${randomUUID()}`]),['23514']);
      await fails(()=>c.query("insert into public.documents(business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,'other','x',$3,'text/plain',1)",[ids.a,ids.ia,`${ids.a}/${randomUUID()}`]),['42501']);
    });
    await fails(()=>db.query('update public.documents set payment_id=$2 where id=$1',[doc,history.id]),['23514']);
    await fails(()=>db.query('update public.documents set payment_id=null where id=$1',[legacyLinked]),['23514']);
    await fails(()=>db.query('update public.documents set customer_id=$2 where id=$1',[legacyLinked,ids.ca]),['23514']);
    await fails(()=>db.query('delete from public.documents where id=$1',[legacyLinked]),['23514']);
    await as(ids.manager,c=>fails(()=>c.query('update public.documents set payment_id=null where id=$1',[legacyLinked]),['42501']));
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0],legacyLinkedBefore);
    assert.deepEqual(await ledger(),before);
    assert.equal((await db.query('select payment_id from public.documents where id=$1',[doc])).rows[0].payment_id,null);
  });
  await test('candidate freezes forward and reverse linked historical metadata against ordinary privileged mutation',async()=>{
    const before=await ledger();
    for(const id of [history.proof_document_id,legacyLinked]) {
      await fails(()=>db.query('update public.documents set storage_path=$2 where id=$1',[id,`${ids.a}/${randomUUID()}`]),['23514']);
      await fails(()=>db.query("update public.documents set file_name='replacement.txt' where id=$1",[id]),['23514']);
      await fails(()=>db.query('update public.documents set invoice_id=null where id=$1',[id]),['23514']);
      await fails(()=>db.query('delete from public.documents where id=$1',[id]),['23514']);
      await as(ids.manager,c=>fails(()=>c.query('delete from public.documents where id=$1',[id]),['42501']));
    }
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[history.proof_document_id])).rows[0],forwardLinkedBefore);
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0],legacyLinkedBefore);
    assert.deepEqual(await ledger(),before);
  });
  await test('local hold blocks even direct privileged insertion and proof rebind or removal',async()=>{
    const before=await ledger();
    await fails(()=>db.query("insert into public.payments(business_id,invoice_id,customer_id,payment_date,amount_paise,payment_mode,idempotency_key,recorded_by,proof_document_id,verification_status) values($1,$2,$3,current_date,1,'upi',$4,$5,$6,'proof_attached')",[ids.a,ids.ia,ids.ca,randomUUID(),ids.ownerA,history.proof_document_id]),['23514']);
    await fails(()=>db.query("update public.payments set proof_document_id=null,verification_status='user_recorded' where id=$1",[history.id]),['23514']);
    await fails(()=>db.query("update public.payments set proof_document_id=$2 where id=$1",[history.id,randomUUID()]),['23514']);
    await fails(()=>db.query("update public.payments set customer_id=$2 where id=$1",[history.id,ids.cb]),['23514']);
    await as(ids.manager,c=>fails(()=>c.query("update public.payments set proof_document_id=null where id=$1",[history.id]),['42501']));
    assert.deepEqual(await ledger(),before);
  });
  await test('local hold historical identical retry is replay only; mismatched retry denied',async()=>{
    const before=await ledger();
    await as(ids.manager,async c=>{
      const params=[history.business_id,history.invoice_id,history.idempotency_key,history.amount_paise,history.payment_date,history.payment_mode,history.reference_id,history.proof_document_id,history.notes];
      const result=(await c.query('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) result',params)).rows[0].result;
      assert.equal(result.replayed,true);assert.equal(result.payment.id,history.id);
      params[7]=randomUUID(); await fails(()=>c.query('select public.record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',params),['22023']);
    });
    assert.deepEqual(await ledger(),before);
  });
  await test('local hold retains void semantics and historical reference',async()=>{
    await as(ids.ownerA,async c=>{
      const result=(await c.query("select public.void_payment($1,$2,'Local upgrade check') result",[ids.a,history.id])).rows[0].result;
      assert.equal(result.payment.status,'voided');assert.equal(result.payment.proof_document_id,history.proof_document_id);
      assert.equal((await c.query("select public.void_payment($1,$2,'Local upgrade check') result",[ids.a,history.id])).rows[0].result.replayed,true);
    });
    assert.deepEqual((await db.query('select * from public.documents where id=$1',[legacyLinked])).rows[0],legacyLinkedBefore);
  });
  await test('local hold allows no-proof payment and idempotent concurrent retries',async()=>{
    const before=await ledger(),key=randomUUID(),clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {
      const r=await Promise.all(clients.map(c=>as(ids.manager,x=>payment(x,ids.a,ids.ia,key,1),c)));
      assert.equal(r[0].rows[0].result.payment.id,r[1].rows[0].result.payment.id);
      assert.deepEqual(r.map(x=>x.rows[0].result.replayed).sort(),[false,true]);
      const after=await ledger();assert.equal(after.payments.length,before.payments.length+1);assert.equal(after.audit.length,before.audit.length+1);
      assert.equal(Number(after.invoice.paid_paise),Number(before.invoice.paid_paise)+1);
      await as(ids.manager,c=>fails(()=>payment(c,ids.a,ids.ia,key,2),['22023']));
    } finally {await Promise.all(clients.map(c=>c.end()));}
  });
  await test('cross-invoice concurrent reuse of one payment key rolls back loser without ledger drift',async()=>{
    const other=(await db.query("select id,paid_paise,balance_paise from public.invoices where business_id=$1 and invoice_number='GSTTEST'",[ids.a])).rows[0];
    assert.ok(other);
    const before=await ledger(), key=randomUUID();
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    const [first,second]=clients;
    try {
      await first.query('BEGIN'); await second.query('BEGIN');
      const winner=(await as(ids.manager,c=>payment(c,ids.a,ids.ia,key,1),first)).rows[0].result;
      const pid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
      await second.query('SET ROLE authenticated');
      await second.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",[ids.manager,JSON.stringify({sub:ids.manager,role:'authenticated'})]);
      const loser=payment(second,ids.a,other.id,key,1).then(()=>({ok:true}),error=>({ok:false,error}));
      let blocked=false;
      for(let i=0;i<100;i++) {
        blocked=(await db.query('select cardinality(pg_blocking_pids($1)) > 0 blocked',[pid])).rows[0].blocked;
        if(blocked) break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(blocked,true,'losing different-invoice write must wait for the uncommitted unique key');
      await first.query('COMMIT');
      const result=await loser;assert.equal(result.ok,false);assert.equal(result.error.code,'23505');
      await second.query('ROLLBACK');
      await as(ids.manager,c=>fails(()=>payment(c,ids.a,other.id,key,1),['22023']));
      const after=await ledger();
      assert.equal(after.payments.length,before.payments.length+1);
      assert.equal(after.audit.length,before.audit.length+1);
      assert.equal(Number(after.invoice.paid_paise),Number(before.invoice.paid_paise)+1);
      assert.deepEqual((await db.query('select id,paid_paise,balance_paise from public.invoices where id=$1',[other.id])).rows[0],other);
      assert.equal((await db.query('select count(*)::int n from public.payments where business_id=$1 and idempotency_key=$2',[ids.a,key])).rows[0].n,1);
      assert.equal((await db.query("select count(*)::int n from public.activity_logs where business_id=$1 and entity_type='payment' and entity_id=$2 and action='payment.recorded'",[ids.a,winner.payment.id])).rows[0].n,1);
      const retry=(await as(ids.manager,c=>payment(c,ids.a,ids.ia,key,1))).rows[0].result;
      assert.equal(retry.replayed,true);assert.equal(retry.payment.id,winner.payment.id);
      assert.deepEqual(await ledger(),after);
      // Both explicit transactions have completed; the connections can be reused.
      assert.equal((await first.query('select 1 as n')).rows[0].n,1);
      assert.equal((await second.query('select 1 as n')).rows[0].n,1);
      assert.equal(winner.replayed,false);
    } finally {
      await Promise.all(clients.map(async c=>{await c.query('ROLLBACK').catch(()=>{});await c.end();}));
    }
  });
  await test('local hold concurrent proof retries fail without ledger changes',async()=>{
    const before=await ledger(),key=randomUUID(),clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try { await Promise.all(clients.map(c=>as(ids.manager,x=>fails(()=>x.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4)",[ids.a,ids.ia,key,history.proof_document_id]),['23514']),c)));assert.deepEqual(await ledger(),before); }
    finally {await Promise.all(clients.map(c=>c.end()));}
  });
  await test('fresh local database applies all migrations and enforces proof hold',async()=>{
    const freshDb=`paidflow_fresh_${process.pid}_${Date.now()}`;let fresh;
    await admin.query(`CREATE DATABASE "${freshDb}"`);
    try {
      const u=new URL(base);u.pathname=`/${freshDb}`;fresh=new Client({connectionString:u.toString()});await fresh.connect();
      await fresh.query(await readFile('tests/database/bootstrap-standalone.sql','utf8'));
      // Build a pre-hold database to preserve a historical issued invoice, then
      // apply the issuance hold to test the upgrade path.
      for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql') && n < '20261107000900_hold_invoice_issuance.sql').sort()) await fresh.query(await readFile(`supabase/migrations/${name}`,'utf8'));
      await fresh.query(await readFile('tests/database/supabase-rls.sql','utf8'));
      await fresh.query("insert into auth.users(id,email,aud,role) values($1,'fresh@example.invalid','authenticated','authenticated')",[ids.ownerA]);
      await fresh.query("insert into public.businesses(id,name,state_code,created_by) values($1,'Fresh','27',$2)",[ids.a,ids.ownerA]);
      await fresh.query("insert into public.business_members(business_id,user_id,role,status) values($1,$2,'owner','active')",[ids.a,ids.ownerA]);
      await fresh.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Buyer',$3)",[ids.ca,ids.a,ids.ownerA]);
      await fresh.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,'FRESH','2026-04-01','2026-04-16',2026,'27','27',100,100,100,100,$4)",[ids.ia,ids.a,ids.ca,ids.ownerA]);
      await fresh.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,line_total_paise) values($1,$2,'work',1,100,100,100)",[ids.a,ids.ia]);
      const doc=randomUUID();
      await as(ids.ownerA,async c=>{
        await issue(c,ids.a,ids.ia);
        await c.query("insert into public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,'payment_receipt','fresh.txt',$4,'text/plain',1)",[doc,ids.a,ids.ia,`${ids.a}/${doc}`]);
        await fails(()=>c.query("select public.record_payment($1,$2,$3,1,'2026-05-01','upi',null,$4)",[ids.a,ids.ia,randomUUID(),doc]),['23514']);
        const p=(await payment(c,ids.a,ids.ia,randomUUID(),1)).rows[0].result.payment;assert.equal(p.proof_document_id,null);
        const reverseId=randomUUID();
        await fails(()=>c.query("insert into public.documents(id,business_id,invoice_id,payment_id,category,file_name,storage_path,mime_type,file_size_bytes) values($1,$2,$3,$4,'payment_receipt','x',$5,'text/plain',1)",[reverseId,ids.a,ids.ia,p.id,`${ids.a}/${reverseId}`]),['23514']);
        assert.equal((await c.query('select count(*)::int n from public.documents where id=$1',[reverseId])).rows[0].n,0);
      },fresh);
      assert.equal((await fresh.query('select count(*)::int n from public.payments')).rows[0].n,1);
      await fresh.query(await readFile('supabase/migrations/20261107000900_hold_invoice_issuance.sql','utf8'));
      await fresh.query(await readFile('supabase/migrations/20261107001000_idempotent_customer_create.sql','utf8'));
      await fresh.query(await readFile('supabase/migrations/20261107001100_member_access_compare_and_set.sql','utf8'));
      await as(ids.ownerA,async c=>{const r=await c.query("select public.create_customer_once($1,$2,'Fresh customer',null,null,null,null,null) result",[ids.a,randomUUID()]);assert.equal(r.rows[0].result.replayed,false);},fresh);
      await as(ids.ownerA,async c=>{
        const d=(await c.query("select public.create_non_gst_invoice_draft($1,$2,$3,'2026-05-01','2026-05-10',$4::jsonb) r",[ids.a,randomUUID(),ids.ca,JSON.stringify([{description:'work',quantity:'1',unitPricePaise:'100'}])])).rows[0].r;
        await fails(()=>issue(c,ids.a,d.invoice_id),['23514']);
        assert.equal((await c.query('select lifecycle_status from public.invoices where id=$1',[d.invoice_id])).rows[0].lifecycle_status,'draft');
        assert.equal((await c.query('select (public.issue_invoice($1,$2)).lifecycle_status status',[ids.a,ids.ia])).rows[0].status,'issued');
      },fresh);
    } finally {if(fresh)await fresh.end();await admin.query(`DROP DATABASE "${freshDb}"`);}
  });
  await test('local hold trigger active, function not executable by runtime, original RPC grant unchanged',async()=>{
    const r=(await db.query("select tgenabled from pg_catalog.pg_trigger where tgrelid='public.payments'::regclass and tgname='deny_payment_proof_attachment'")).rows[0];assert.equal(r.tgenabled,'O');
    assert.equal((await db.query("select has_function_privilege('authenticated','paidflow_private.deny_payment_proof_attachment()','EXECUTE') x")).rows[0].x,false);
    assert.equal((await db.query("select tgenabled from pg_catalog.pg_trigger where tgrelid='public.documents'::regclass and tgname='deny_document_payment_association'")).rows[0].tgenabled,'O');
    assert.equal((await db.query("select has_function_privilege('authenticated','paidflow_private.deny_document_payment_association()','EXECUTE') x")).rows[0].x,false);
    const guard=(await db.query("select prosecdef,proconfig,pg_get_userbyid(proowner) owner from pg_proc where oid='paidflow_private.deny_document_payment_association()'::regprocedure")).rows[0];
    assert.equal(guard.prosecdef,true);assert.ok(guard.proconfig.includes('search_path=pg_catalog, pg_temp'));assert.equal(guard.owner,'postgres');
    assert.equal((await db.query("select has_function_privilege('authenticated','public.record_payment(uuid,uuid,uuid,bigint,date,text,text,uuid,text)','EXECUTE') x")).rows[0].x,true);
    await as(ids.manager,c=>fails(()=>c.query('alter table public.payments disable trigger deny_payment_proof_attachment'),['42501']));
  });
  // Candidate migration 008: local only, layered after the fail-closed proof hold.
  await db.query(await readFile('supabase/migrations/20261107000800_non_gst_invoice_draft.sql','utf8'));
  const lines=[{description:'Synthetic work',quantity:'1.250',unitPricePaise:'101'}];
  const createDraft=(c,b,key,customer,rows=lines)=>c.query("select public.create_non_gst_invoice_draft($1,$2,$3,'2026-05-01','2026-05-15',$4::jsonb) result",[b,key,customer,JSON.stringify(rows)]);
  const invoiceCounts=async()=> (await db.query("select (select count(*)::int from public.invoices where business_id=$1) invoices,(select count(*)::int from public.invoice_items where business_id=$1) items,(select count(*)::int from public.activity_logs where business_id=$1) audits,(select count(*)::int from paidflow_private.invoice_draft_requests where business_id=$1) requests,(select coalesce(sum(last_number),0)::text from public.invoice_sequences where business_id=$1) sequence",[ids.a])).rows[0];
  await test('non-GST draft creates exact rounded line, totals, one invoice and replay',async()=>{
    const key=randomUUID(),before=await invoiceCounts();
    await as(ids.manager,async c=>{
      const first=(await createDraft(c,ids.a,key,ids.ca)).rows[0].result;
      const replay=(await createDraft(c,ids.a,key,ids.ca)).rows[0].result;
      assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.equal(first.invoice_id,replay.invoice_id);
      const inv=(await c.query('select invoice_number,lifecycle_status,total_paise,balance_paise,supply_type from public.invoices where id=$1',[first.invoice_id])).rows[0];
      assert.match(inv.invoice_number,/2026-27/);assert.equal(inv.lifecycle_status,'draft');assert.equal(inv.total_paise,'126');assert.equal(inv.balance_paise,'126');assert.equal(inv.supply_type,'non_gst');
      const row=(await c.query('select quantity,unit_price_paise,line_total_paise from public.invoice_items where invoice_id=$1',[first.invoice_id])).rows[0];assert.equal(row.quantity,'1.250');assert.equal(row.unit_price_paise,'101');assert.equal(row.line_total_paise,'126');
      await fails(()=>createDraft(c,ids.a,key,ids.ca,[{...lines[0],unitPricePaise:'102'}]),['22023']);
    });
    const after=await invoiceCounts();assert.equal(after.invoices,before.invoices+1);assert.equal(after.items,before.items+1);assert.equal(after.audits,before.audits+1);assert.equal(after.requests,before.requests+1);assert.equal(Number(after.sequence),Number(before.sequence)+1);
  });
  await test('non-GST draft rejects invalid lines and cross-tenant customer with no changes',async()=>{
    const before=await invoiceCounts();
    await as(ids.manager,async c=>{
      await fails(()=>createDraft(c,ids.a,randomUUID(),ids.cb),['P0002']);
      for(const rows of [[],[{...lines[0],quantity:'0'}],[{...lines[0],quantity:'1.0001'}],[{...lines[0],unitPricePaise:'-1'}],[{...lines[0],unitPricePaise:'9007199254740992'}],[{...lines[0],unitPricePaise:'0'}],[{...lines[0],tax:'18'}]]) await fails(()=>createDraft(c,ids.a,randomUUID(),ids.ca,rows),['22023']);
    });
    assert.deepEqual(await invoiceCounts(),before);
  });
  await test('non-GST draft denies viewer/accountant and anonymous calls',async()=>{
    const before=await invoiceCounts();
    for(const actor of [ids.viewer,ids.accountant]) await as(actor,c=>fails(()=>createDraft(c,ids.a,randomUUID(),ids.ca),['42501']));
    await db.query('SET ROLE anon');try{await fails(()=>createDraft(db,ids.a,randomUUID(),ids.ca),['42501']);}finally{await db.query('RESET ROLE');}
    assert.deepEqual(await invoiceCounts(),before);
  });
  await test('non-GST draft rolls back invoice, sequence, line and audit on later failure',async()=>{
    const before=await invoiceCounts();await db.query("create function paidflow_private.test_abort_draft() returns trigger language plpgsql as $$ begin raise exception 'Synthetic failure'; end $$; create trigger test_abort_draft before insert on public.invoice_items for each row execute function paidflow_private.test_abort_draft()");
    try { await as(ids.manager,c=>fails(()=>createDraft(c,ids.a,randomUUID(),ids.ca),['P0001']));assert.deepEqual(await invoiceCounts(),before); }
    finally { await db.query('drop trigger test_abort_draft on public.invoice_items; drop function paidflow_private.test_abort_draft()'); }
  });
  await test('concurrent identical non-GST draft retries create one invoice',async()=>{
    const before=await invoiceCounts(),key=randomUUID(),clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {const results=await Promise.all(clients.map(c=>as(ids.manager,x=>createDraft(x,ids.a,key,ids.ca),c)));assert.equal(results[0].rows[0].result.invoice_id,results[1].rows[0].result.invoice_id);assert.deepEqual(results.map(x=>x.rows[0].result.replayed).sort(),[false,true]);const after=await invoiceCounts();assert.equal(after.invoices,before.invoices+1);assert.equal(after.requests,before.requests+1);assert.equal(after.items,before.items+1);assert.equal(after.audits,before.audits+1);}
    finally {await Promise.all(clients.map(c=>c.end()));}
  });
  await test('concurrent conflicting non-GST draft requests never create two invoices',async()=>{
    const before=await invoiceCounts(),key=randomUUID(),clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {const results=await Promise.allSettled(clients.map((c,i)=>as(ids.manager,x=>createDraft(x,ids.a,key,ids.ca,[{...lines[0],unitPricePaise:i?'102':'101'}]),c)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.equal(rejected.reason.code,'22023');const after=await invoiceCounts();assert.equal(after.invoices,before.invoices+1);assert.equal(after.requests,before.requests+1);assert.equal(after.audits,before.audits+1);}
    finally {await Promise.all(clients.map(c=>c.end()));}
  });
  await test('non-GST draft request table is not accessible to authenticated role',async()=>{
    assert.equal((await db.query("select has_table_privilege('authenticated','paidflow_private.invoice_draft_requests','SELECT,INSERT,UPDATE,DELETE') p")).rows[0].p,false);
    await as(ids.manager,c=>fails(()=>c.query('select * from paidflow_private.invoice_draft_requests'),['42501']));
  });
  // Synthetic arithmetic examples only. They validate the implemented math,
  // not GST law, classification, applicable rates, HSN or tax compliance.
  await test('synthetic GST intra/inter-state examples preserve paise and tax split',async()=>{
    await db.query('BEGIN');
    try {
      await as(ids.manager,async c=>{
        for(const [kind,destination,cgst,sgst,igst] of [['intra_state','27',10,9,0],['inter_state','29',0,0,19]]) {
          const id=randomUUID();
          await c.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,is_gst_invoice,supply_type,subtotal_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,balance_paise) values($1,$2,$3,$4,'2026-05-01','2026-05-15',2026,'27',$5,true,$6,105,105,$7,$8,$9,124,124)",[id,ids.a,ids.ca,`SYN-${id}`,destination,kind,cgst,sgst,igst]);
          await c.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,gst_rate_bps,cgst_paise,sgst_paise,igst_paise,line_total_paise) values($1,$2,'synthetic',1,105,105,1800,$3,$4,$5,124)",[ids.a,id,cgst,sgst,igst]);
          await issue(c,ids.a,id);
          const row=(await c.query('select lifecycle_status,total_paise,balance_paise,cgst_paise,sgst_paise,igst_paise from public.invoices where id=$1',[id])).rows[0];
          assert.equal(row.lifecycle_status,'issued');assert.equal(row.total_paise,'124');assert.equal(row.balance_paise,'124');assert.equal(row.cgst_paise,String(cgst));assert.equal(row.sgst_paise,String(sgst));assert.equal(row.igst_paise,String(igst));
        }
      });
    } finally { await db.query('ROLLBACK'); }
  });
  await test('synthetic GST invalid intra-state tax split cannot be issued',async()=>{
    await db.query('BEGIN');
    try {
      await as(ids.manager,async c=>{
        const id=randomUUID();
        await c.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,is_gst_invoice,supply_type,subtotal_paise,taxable_paise,cgst_paise,total_paise,balance_paise) values($1,$2,$3,$4,'2026-05-01','2026-05-15',2026,'27','27',true,'intra_state',105,105,19,124,124)",[id,ids.a,ids.ca,`BAD-${id}`]);
        await c.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,gst_rate_bps,cgst_paise,line_total_paise) values($1,$2,'synthetic',1,105,105,1800,19,124)",[ids.a,id]);
        await c.query('SAVEPOINT before_issue');try {await fails(()=>issue(c,ids.a,id),['P0001']);} finally {await c.query('ROLLBACK TO SAVEPOINT before_issue');}
        assert.equal((await c.query('select lifecycle_status from public.invoices where id=$1',[id])).rows[0].lifecycle_status,'draft');
      });
    } finally { await db.query('ROLLBACK'); }
  });

  await test('independent customer ledger reconciliation covers partial, voided, archived and concurrent payments',async()=>{
    const customer=randomUUID(), invoices=[randomUUID(),randomUUID(),randomUUID()];
    await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Reconciliation fixture',$3)",[customer,ids.a,ids.ownerA]);
    for(const [i,id] of invoices.entries()) {
      const total=(i+1)*10000;
      await db.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,$4,'2026-04-01','2026-04-16',2026,'27','27',$5,$5,$5,$5,$6)",[id,ids.a,customer,`REC-${id}`,total,ids.ownerA]);
      await db.query("insert into public.invoice_items(business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,line_total_paise) values($1,$2,'synthetic',1,$3,$3,$3)",[ids.a,id,total]);
      await as(ids.ownerA,c=>issue(c,ids.a,id));
    }
    const voided=(await as(ids.manager,c=>payment(c,ids.a,invoices[0],randomUUID(),2000))).rows[0].result.payment.id;
    await as(ids.manager,c=>payment(c,ids.a,invoices[0],randomUUID(),1000));
    await as(ids.ownerA,c=>c.query("select public.void_payment($1,$2,'Fixture correction')",[ids.a,voided]));
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {await Promise.all(clients.map((c,i)=>as(ids.manager,cl=>payment(cl,ids.a,invoices[1],randomUUID(),i?4000:3000),c)));} finally {await Promise.all(clients.map(c=>c.end()));}
    await as(ids.manager,c=>payment(c,ids.a,invoices[2],randomUUID(),5000));
    await db.query('update public.invoices set is_archived=true where id=$1',[invoices[2]]);
    const inv=(await db.query('select id,total_paise,paid_paise,balance_paise,is_archived from public.invoices where business_id=$1 and customer_id=$2 order by id',[ids.a,customer])).rows;
    const pays=(await db.query('select invoice_id,amount_paise,status from public.payments where business_id=$1 and customer_id=$2',[ids.a,customer])).rows;
    const sums=new Map(); for(const p of pays) if(p.status==='recorded') sums.set(p.invoice_id,(sums.get(p.invoice_id)||0n)+BigInt(p.amount_paise));
    let active=0n,includingArchived=0n;for(const row of inv){const independent=BigInt(row.total_paise)-(sums.get(row.id)||0n);assert.equal(BigInt(row.paid_paise),sums.get(row.id)||0n);assert.equal(BigInt(row.balance_paise),independent);includingArchived+=independent;if(!row.is_archived)active+=independent;}
    assert.equal(pays.filter(p=>p.status==='voided').length,1);assert.equal(active,22000n);assert.equal(includingArchived,47000n);
    const display=(await db.query("select sum(balance_paise)::text n from public.invoices where business_id=$1 and customer_id=$2 and lifecycle_status='issued' and not is_archived",[ids.a,customer])).rows[0].n;assert.equal(BigInt(display),active);
  });
  await test('independent aging reconciliation excludes cancelled and archived at due-date boundaries',async()=>{
    const customer=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Aging fixture',$3)",[customer,ids.a,ids.ownerA]);
    const days=[0,1,30,31,60,61,90,91];
    for (const [i,d] of days.entries()) await db.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,lifecycle_status,issued_at,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,'2026-01-01',date '2026-05-01'-$4::integer,2025,'27','27','issued',clock_timestamp(),$5,$5,$5,$5,$6)",[ids.a,customer,`AGE-${customer}-${i}`,d,(i+1)*100,ids.ownerA]);
    await db.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,lifecycle_status,issued_at,is_archived,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,'2026-01-01','2026-02-01',2025,'27','27','issued',clock_timestamp(),true,900,900,900,900,$4)",[ids.a,customer,`ARCH-${customer}`,ids.ownerA]);
    await db.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,lifecycle_status,cancelled_at,cancelled_reason,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,'2026-01-01','2026-02-01',2025,'27','27','cancelled',clock_timestamp(),'Fixture cancellation',1000,1000,1000,1000,$4)",[ids.a,customer,`CANCEL-${customer}`,ids.ownerA]);
    const rows=(await db.query("select total_paise,balance_paise,due_date::text,lifecycle_status,is_archived from public.invoices where business_id=$1 and customer_id=$2",[ids.a,customer])).rows;
    const expected=[[0,0n],[0,0n],[0,0n],[0,0n],[0,0n]];let excluded=0n;
    for (const row of rows) {const value=BigInt(row.total_paise);assert.equal(BigInt(row.balance_paise),value);if(row.is_archived||row.lifecycle_status!=='issued'){excluded+=value;continue;}const age=(Date.parse('2026-05-01T00:00:00Z')-Date.parse(row.due_date+'T00:00:00Z'))/86400000;const b=age<=0?0:age<=30?1:age<=60?2:age<=90?3:4;expected[b][0]++;expected[b][1]+=value;}
    assert.deepEqual(expected,[[1,100n],[2,500n],[2,900n],[2,1300n],[1,800n]]);assert.equal(excluded,1900n);assert.equal(expected.reduce((n,b)=>n+b[1],0n),3600n);
    const sql=(await db.query("select count(*)::int n,sum(balance_paise)::text total from public.invoices where business_id=$1 and customer_id=$2 and lifecycle_status='issued' and not is_archived",[ids.a,customer])).rows[0];assert.deepEqual(sql,{n:8,total:'3600'});
  });
  await test('large synthetic history exposes 1001 issued rows rather than a partial total',async()=>{
    const customer=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Large history fixture',$3)",[customer,ids.a,ids.ownerA]);
    await db.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,lifecycle_status,issued_at,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) select $1,$2,'LARGE-'||($2::uuid)::text||'-'||g,'2026-04-01','2026-04-30',2026,'27','27','issued',clock_timestamp(),1,1,1,1,$3 from generate_series(1,1001) g",[ids.a,customer,ids.ownerA]);
    const aggregate=(await db.query("select count(*)::int n,sum(total_paise)::text total from public.invoices where business_id=$1 and customer_id=$2 and lifecycle_status='issued' and not is_archived",[ids.a,customer])).rows[0];assert.deepEqual(aggregate,{n:1001,total:'1001'});
    const first=(await db.query("select id from public.invoices where business_id=$1 and customer_id=$2 and lifecycle_status='issued' and not is_archived order by id limit 1000",[ids.a,customer])).rows;assert.equal(first.length,1000);assert.ok(aggregate.n>first.length);
  });

  await test('mixed snapshots expose concurrent reconciliation hazard',async()=>{
    const customer=randomUUID(),id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Snapshot fixture',$3)",[customer,ids.a,ids.ownerA]);
    await db.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,lifecycle_status,issued_at,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,$4,'2026-04-01','2026-04-30',2026,'27','27','issued',clock_timestamp(),10000,10000,10000,10000,$5)",[id,ids.a,customer,`SNAP-${id}`,ids.ownerA]);
    const reader=new Client({connectionString:dburl.toString()});await reader.connect();
    try {
      await reader.query('begin isolation level read committed');
      const old=(await reader.query('select total_paise,balance_paise from public.invoices where id=$1',[id])).rows[0];
      await as(ids.manager,c=>payment(c,ids.a,id,randomUUID(),1500));
      const paid=(await reader.query("select coalesce(sum(amount_paise),0)::text paid from public.payments where invoice_id=$1 and status='recorded'",[id])).rows[0].paid;
      assert.equal(BigInt(old.balance_paise),10000n);assert.equal(BigInt(old.total_paise)-BigInt(paid),8500n);assert.notEqual(BigInt(old.balance_paise),BigInt(old.total_paise)-BigInt(paid));
      await reader.query('rollback');
    } finally {await reader.end();}
  });

  const snapshotCustomer=randomUUID(),snapshotInvoice=randomUUID();
  await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Snapshot 016',$3)",[snapshotCustomer,ids.a,ids.ownerA]);
  await db.query("insert into public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,lifecycle_status,issued_at,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) values($1,$2,$3,$4,'2026-04-01','2026-04-30',2026,'27','27','issued',clock_timestamp(),10000,10000,10000,10000,$5)",[snapshotInvoice,ids.a,snapshotCustomer,`S016-${snapshotInvoice}`,ids.ownerA]);
  const precisionCustomer=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Precision snapshot',$3)",[precisionCustomer,ids.a,ids.ownerA]);
  await db.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,lifecycle_status,issued_at,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) select $1,$2,'PREC-'||($2::uuid)::text||'-'||g,'2026-04-01','2026-04-30',2026,'27','27','issued',clock_timestamp(),9007199254740991,9007199254740991,9007199254740991,9007199254740991,$3 from generate_series(1,2) g",[ids.a,precisionCustomer,ids.ownerA]);
  await db.query(await readFile('supabase/migrations/20261107000900_hold_invoice_issuance.sql','utf8'));
  await test('issuance hold blocks direct RPC and direct privileged writes without ledger or audit changes',async()=>{
    const draft=(await as(ids.manager,c=>createDraft(c,ids.a,randomUUID(),ids.ca))).rows[0].result.invoice_id;
    const before=await invoiceCounts();
    await as(ids.manager,c=>fails(()=>issue(c,ids.a,draft),['23514']));
    await fails(()=>db.query("update public.invoices set lifecycle_status='issued',issued_at=clock_timestamp() where id=$1",[draft]),['23514']);
    await fails(()=>db.query("insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,lifecycle_status,issued_at,created_by) values($1,$2,'HOLD-ATTEMPT','2026-05-01','2026-05-15',2026,'27','27','issued',clock_timestamp(),$3)",[ids.a,ids.ca,ids.ownerA]),['23514']);
    assert.equal((await db.query('select lifecycle_status from public.invoices where id=$1',[draft])).rows[0].lifecycle_status,'draft');
    assert.deepEqual(await invoiceCounts(),before);
  });
  await test('issuance hold preserves existing issue replay, no-proof payment and void history',async()=>{
    const before=await invoiceCounts();
    await as(ids.manager,async c=>{assert.equal((await c.query('select (public.issue_invoice($1,$2)).lifecycle_status status',[ids.a,ids.ia])).rows[0].status,'issued');});
    assert.deepEqual(await invoiceCounts(),before);
    const pay=await as(ids.manager,c=>payment(c,ids.a,ids.ia,randomUUID(),1));
    assert.equal(pay.rows[0].result.payment.proof_document_id,null);
    await as(ids.ownerA,async c=>{const result=(await c.query("select public.void_payment($1,$2,'Synthetic correction') result",[ids.a,pay.rows[0].result.payment.id])).rows[0].result;assert.equal(result.payment.status,'voided');});
  });
  await test('payment partial retry and void preserve balances and single audit events under holds',async()=>{
    const key=randomUUID();
    const before=(await db.query("select paid_paise,balance_paise,(select count(*)::int from public.activity_logs where business_id=$1 and action='payment.recorded') recorded_audits,(select count(*)::int from public.activity_logs where business_id=$1 and action='payment.voided') void_audits from public.invoices where id=$2",[ids.a,ids.ia])).rows[0];
    const first=await as(ids.accountant,async c=>{
      const r=(await payment(c,ids.a,ids.ia,key,5)).rows[0].result;
      const replay=(await payment(c,ids.a,ids.ia,key,5)).rows[0].result;
      assert.equal(replay.replayed,true);assert.equal(replay.payment.id,r.payment.id);
      await fails(()=>payment(c,ids.a,ids.ia,key,6),['22023']);
      await fails(()=>payment(c,ids.a,ids.ia,randomUUID(),Number(before.balance_paise)+1),['22023']);
      return r;
    });
    const middle=(await db.query('select paid_paise,balance_paise from public.invoices where id=$1',[ids.ia])).rows[0];
    assert.equal(BigInt(middle.paid_paise),BigInt(before.paid_paise)+5n);assert.equal(BigInt(middle.balance_paise),BigInt(before.balance_paise)-5n);
    await as(ids.ownerA,async c=>{
      const p=(await c.query("select public.void_payment($1,$2,'Synthetic correction') result",[ids.a,first.payment.id])).rows[0].result;
      assert.equal(p.payment.status,'voided');assert.equal(p.replayed,false);
      const repeat=(await c.query("select public.void_payment($1,$2,'Synthetic correction') result",[ids.a,first.payment.id])).rows[0].result;
      assert.equal(repeat.replayed,true);
    });
    const final=await as(ids.accountant,c=>payment(c,ids.a,ids.ia,key,5));assert.equal(final.rows[0].result.replayed,true);assert.equal(final.rows[0].result.payment.status,'voided');
    const after=(await db.query("select paid_paise,balance_paise,(select count(*)::int from public.activity_logs where business_id=$1 and action='payment.recorded') recorded_audits,(select count(*)::int from public.activity_logs where business_id=$1 and action='payment.voided') void_audits from public.invoices where id=$2",[ids.a,ids.ia])).rows[0];
    assert.equal(after.paid_paise,before.paid_paise);assert.equal(after.balance_paise,before.balance_paise);assert.equal(after.recorded_audits,before.recorded_audits+1);assert.equal(after.void_audits,before.void_audits+1);
  });
  await test('issuance hold function inaccessible to authenticated role and active on invoices',async()=>{
    assert.equal((await db.query("select tgenabled from pg_catalog.pg_trigger where tgrelid='public.invoices'::regclass and tgname='hold_invoice_issuance'")).rows[0].tgenabled,'O');
    assert.equal((await db.query("select has_function_privilege('authenticated','paidflow_private.hold_invoice_issuance()','EXECUTE') p")).rows[0].p,false);
    await as(ids.manager,c=>fails(()=>c.query('alter table public.invoices disable trigger hold_invoice_issuance'),['42501']));
  });
  // Candidate 010 is local only; run after both proof and issuance holds.
  await db.query(await readFile('supabase/migrations/20261107001000_idempotent_customer_create.sql','utf8'));
  const createCustomer=(c,b,k,name='Synthetic customer')=>c.query("select public.create_customer_once($1,$2,$3,' Contact ',' buyer@example.invalid ',' 123 ','27abcde1234f1z5','27') result",[b,k,name]);
  const customerCounts=async()=> (await db.query("select (select count(*)::int from public.customers where business_id=$1) customers,(select count(*)::int from public.activity_logs where business_id=$1 and action='customer.created') audits,(select count(*)::int from paidflow_private.customer_create_requests where business_id=$1) requests",[ids.a])).rows[0];
  await test('customer create and identical replay commit one customer and audit',async()=>{
    const key=randomUUID(),before=await customerCounts();
    const first=await as(ids.manager,async c=>{
      const a=(await createCustomer(c,ids.a,key)).rows[0].result;const b=(await createCustomer(c,ids.a,key)).rows[0].result;
      assert.equal(a.replayed,false);assert.equal(b.replayed,true);assert.equal(a.customer_id,b.customer_id);await fails(()=>createCustomer(c,ids.a,key,'Different'),['22023']);return a;
    });
    const after=await customerCounts();assert.equal(after.customers,before.customers+1);assert.equal(after.audits,before.audits+1);assert.equal(after.requests,before.requests+1);
    const row=(await db.query('select name,contact_person,email,phone,gstin,state_code,created_by from public.customers where id=$1',[first.customer_id])).rows[0];assert.deepEqual(row,{name:'Synthetic customer',contact_person:'Contact',email:'buyer@example.invalid',phone:'123',gstin:'27ABCDE1234F1Z5',state_code:'27',created_by:ids.manager});
    await db.query("update public.customers set name='Later edit',is_archived=true where id=$1",[first.customer_id]);
    const replay=await as(ids.manager,c=>createCustomer(c,ids.a,key));assert.equal(replay.rows[0].result.replayed,true);assert.equal((await db.query('select name from public.customers where id=$1',[first.customer_id])).rows[0].name,'Later edit');
  });
  await test('customer create enforces active roles, tenant, validity and private privileges',async()=>{
    const before=await customerCounts();for(const role of [ids.viewer,ids.accountant,ids.suspended,ids.ownerB]) await as(role,c=>fails(()=>createCustomer(c,ids.a,randomUUID()),['42501']));
    await as(ids.manager,async c=>{await fails(()=>createCustomer(c,ids.a,randomUUID(),'  '),['22023']);await fails(()=>c.query("select public.create_customer_once($1,$2,'x',null,null,null,'27ABCDE1234F1Z5','29')",[ids.a,randomUUID()]),['22023']);await fails(()=>c.query('select * from paidflow_private.customer_create_requests'),['42501']);});
    assert.deepEqual(await customerCounts(),before);
    assert.equal((await db.query("select has_function_privilege('anon','public.create_customer_once(uuid,uuid,text,text,text,text,text,text)','execute') x")).rows[0].x,false);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.create_customer_once(uuid,uuid,text,text,text,text,text,text)','execute') x")).rows[0].x,true);
  });
  await test('customer create rolls back customer and audit if request insert fails',async()=>{
    const before=await customerCounts();await db.query("create function paidflow_private.test_customer_abort() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$; create trigger test_customer_abort before insert on paidflow_private.customer_create_requests for each row execute function paidflow_private.test_customer_abort()");
    try {await as(ids.manager,c=>fails(()=>createCustomer(c,ids.a,randomUUID()),['P0001']));assert.deepEqual(await customerCounts(),before);} finally {await db.query('drop trigger test_customer_abort on paidflow_private.customer_create_requests; drop function paidflow_private.test_customer_abort()');}
  });
  await test('concurrent identical and conflicting customer keys create at most one row',async()=>{
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {
      let before=await customerCounts(),key=randomUUID();const results=await Promise.all(clients.map(c=>as(ids.manager,cl=>createCustomer(cl,ids.a,key),c)));const first=results.map(r=>r.rows[0].result);assert.equal(first[0].customer_id,first[1].customer_id);assert.deepEqual(first.map(x=>x.replayed).sort(),[false,true]);let after=await customerCounts();assert.equal(after.customers,before.customers+1);assert.equal(after.audits,before.audits+1);assert.equal(after.requests,before.requests+1);
      before=after;key=randomUUID();const conflicts=await Promise.allSettled(clients.map((c,i)=>as(ids.manager,cl=>createCustomer(cl,ids.a,key,`Different ${i}`),c)));assert.equal(conflicts.filter(x=>x.status==='fulfilled').length,1);const rejected=conflicts.find(x=>x.status==='rejected');assert.equal(rejected.reason.code,'22023');after=await customerCounts();assert.equal(after.customers,before.customers+1);assert.equal(after.audits,before.audits+1);assert.equal(after.requests,before.requests+1);
    } finally {await Promise.all(clients.map(c=>c.end()));}
  });

  await test('customer snapshot updates prevent ordinary concurrent lost edits under RLS',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Synthetic snapshot',$3)",[id,ids.a,ids.ownerA]);
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {
      const update=(c,name,business=ids.a)=>c.query("update public.customers set name=$1 where business_id=$2 and id=$3 and is_archived=false and name=$4 and contact_person is null and email is null and phone is null and gstin is null and state_code is null returning id",[name,business,id,'Synthetic snapshot']);
      const results=await Promise.all(clients.map((c,i)=>as(ids.manager,cl=>update(cl,`Edit ${i}`),c)));
      assert.deepEqual(results.map(r=>r.rowCount).sort(),[0,1]);
      const winning=(await db.query('select name from public.customers where id=$1',[id])).rows[0].name;
      await as(ids.viewer,async c=>{const denied=await c.query('update public.customers set name=$1 where business_id=$2 and id=$3 returning id',["Denied",ids.a,id]);assert.equal(denied.rowCount,0);});
      await as(ids.ownerB,async c=>{assert.equal((await c.query('select id from public.customers where business_id=$1 and id=$2',[ids.a,id])).rowCount,0);assert.equal((await c.query('update public.customers set name=$1 where business_id=$2 and id=$3 returning id',["Denied",ids.a,id])).rowCount,0);});
      assert.equal((await db.query('select name from public.customers where id=$1',[id])).rows[0].name,winning);
    } finally {await Promise.all(clients.map(c=>c.end()));}
  });
  await test('customer histories are tenant isolated under mock Supabase RLS',async()=>{
    await as(ids.ownerB,async c=>{for(const table of ['customers','invoices','payments','activity_logs']) { const r=await c.query(`select id from public.${table} where business_id=$1`,[ids.a]); assert.equal(r.rowCount,0); }});
    await as(ids.viewer,async c=>{assert.equal((await c.query('select id from public.customers where business_id=$1 and id=$2',[ids.a,ids.ca])).rowCount,1);assert.equal((await c.query('select id from public.invoices where business_id=$1 and customer_id=$2',[ids.a,ids.ca])).rowCount>0,true);});
  });

  await db.query(await readFile('supabase/migrations/20261107001100_member_access_compare_and_set.sql','utf8'));
  const cas=(c,b,u,oldRole,oldStatus,newRole,newStatus)=>c.query('select public.set_member_access_if_current($1,$2,$3,$4,$5,$6) result',[b,u,oldRole,oldStatus,newRole,newStatus]);
  await test('team access compare-and-set enforces roles and unchanged expected state',async()=>{
    const before=(await db.query("select count(*)::int n from public.activity_logs where business_id=$1 and action='member.access_changed'",[ids.a])).rows[0].n;
    await as(ids.ownerA,async c=>{
      await fails(()=>cas(c,ids.a,ids.ownerA,'owner','active','viewer','active'),['42501']);
      await fails(()=>cas(c,ids.a,ids.manager,'manager','active','owner','active'),['42501']);
      await fails(()=>cas(c,ids.b,ids.ownerB,'owner','active','viewer','active'),['42501']);
      const result=await cas(c,ids.a,ids.viewer,'viewer','active','accountant','suspended');assert.equal(result.rows[0].result.role,'accountant');assert.equal(result.rows[0].result.status,'suspended');
      await fails(()=>cas(c,ids.a,ids.viewer,'viewer','active','manager','active'),['40001']);
      await cas(c,ids.a,ids.viewer,'accountant','suspended','accountant','suspended');
    });
    const after=(await db.query("select count(*)::int n from public.activity_logs where business_id=$1 and action='member.access_changed'",[ids.a])).rows[0].n;assert.equal(after,before+1);
    await as(ids.ownerA,c=>cas(c,ids.a,ids.viewer,'accountant','suspended','viewer','active'));
    await as(ids.ownerA,c=>cas(c,ids.a,ids.manager,'manager','active','admin','active'));
    try {await as(ids.manager,async c=>{await fails(()=>cas(c,ids.a,ids.viewer,'viewer','active','admin','active'),['42501']);await fails(()=>cas(c,ids.a,ids.ownerA,'owner','active','viewer','active'),['42501']);});await as(ids.viewer,c=>fails(()=>cas(c,ids.a,ids.manager,'admin','active','manager','active'),['42501']));}
    finally {await as(ids.ownerA,c=>cas(c,ids.a,ids.manager,'admin','active','manager','active'));}
    assert.equal((await db.query("select has_function_privilege('anon','public.set_member_access_if_current(uuid,uuid,public.business_role,public.member_status,public.business_role,public.member_status)','execute') x")).rows[0].x,false);
  });
  await test('concurrent team changes from the same snapshot allow only one update and audit',async()=>{
    const before=(await db.query("select count(*)::int n from public.activity_logs where business_id=$1 and action='member.access_changed'",[ids.a])).rows[0].n;
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {
      const results=await Promise.allSettled(clients.map((c,i)=>as(ids.ownerA,cl=>cas(cl,ids.a,ids.viewer,'viewer','active',i?'accountant':'manager','active'),c)));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'40001');
      assert.equal((await db.query("select count(*)::int n from public.activity_logs where business_id=$1 and action='member.access_changed'",[ids.a])).rows[0].n,before+1);
      const role=(await db.query('select role from public.business_members where business_id=$1 and user_id=$2',[ids.a,ids.viewer])).rows[0].role;await as(ids.ownerA,c=>cas(c,ids.a,ids.viewer,role,'active','viewer','active'));
    } finally {await Promise.all(clients.map(c=>c.end()));}
  });

  await test('legacy customer grants and new RPC unavailable before migration',async()=>{
    const r=(await db.query("select has_table_privilege('authenticated','public.customers','INSERT') ins,has_column_privilege('authenticated','public.customers','name','UPDATE') upd,to_regprocedure('public.update_customer_if_version(uuid,uuid,integer,text,text,text,text,text,text)') is null rpc_absent")).rows[0];assert.deepEqual(r,{ins:true,upd:true,rpc_absent:true});
  });
  await db.query(await readFile('supabase/migrations/20261107001200_customer_versioned_edits.sql','utf8'));
  await test('new version migration revokes legacy edits and protects customer identity',async()=>{
    const r=(await db.query("select has_column_privilege('authenticated','public.customers','name','UPDATE') upd,has_column_privilege('authenticated','public.customers','edit_version','UPDATE') ver,has_table_privilege('authenticated','public.customers','INSERT') ins,has_function_privilege('authenticated','public.update_customer_if_version(uuid,uuid,integer,text,text,text,text,text,text)','execute') rpc")).rows[0];assert.deepEqual(r,{upd:false,ver:false,ins:true,rpc:true});
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Identity fixture',$3)",[id,ids.a,ids.ownerA]);
    for (const sql of ['update public.customers set business_id=$2 where id=$1','update public.customers set created_by=$2 where id=$1']) await fails(()=>db.query(sql,[id,sql.includes('business_id')?ids.b:ids.ownerB]),['23514']);
    assert.equal((await db.query('select edit_version from public.customers where id=$1',[id])).rows[0].edit_version,1);
  });

  const customerEdit=(c,b,id,ver,name)=>c.query("select public.update_customer_if_version($1,$2,$3,$4,null,null,null,null,null) result",[b,id,ver,name]);
  await test('customer version RPC blocks direct writes, stale ABA and cross-tenant/role access',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Start',$3)",[id,ids.a,ids.ownerA]);
    await as(ids.manager,async c=>{
      await fails(()=>c.query("update public.customers set name='bypass' where id=$1",[id]),['42501']);
      assert.equal((await customerEdit(c,ids.a,id,1,'Changed')).rows[0].result.edit_version,2);
      assert.equal((await customerEdit(c,ids.a,id,2,'Start')).rows[0].result.edit_version,3);
      await fails(()=>customerEdit(c,ids.a,id,1,'Lost'),['40001']);
      await fails(()=>customerEdit(c,ids.b,ids.cb,1,'Other tenant'),['42501']);
    });
    await as(ids.viewer,c=>fails(()=>customerEdit(c,ids.a,id,3,'Denied'),['42501']));
    await as(ids.ownerB,c=>fails(()=>customerEdit(c,ids.b,id,3,'Denied'),['40001']));
    await db.query("update public.customers set name='Privileged edit' where id=$1",[id]);
    const row=(await db.query('select name,edit_version from public.customers where id=$1',[id])).rows[0];assert.deepEqual(row,{name:'Privileged edit',edit_version:4});
    await as(ids.manager,c=>fails(()=>customerEdit(c,ids.a,id,3,'Stale'),['40001']));
  });
  await test('customer version RPC allows exactly one simultaneous same-version edit',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Parallel',$3)",[id,ids.a,ids.ownerA]);
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {const results=await Promise.allSettled(clients.map((c,i)=>as(ids.manager,cl=>customerEdit(cl,ids.a,id,1,`Winner ${i}`),c)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'40001');assert.equal((await db.query('select edit_version from public.customers where id=$1',[id])).rows[0].edit_version,2);} finally {await Promise.all(clients.map(c=>c.end()));}
  });

  const dupMigration=await readFile('supabase/migrations/20261107001300_customer_duplicate_policy.sql','utf8');
  await test('migration preserves legacy duplicate records and histories',async()=>{
    const before=(await db.query("select count(*)::int n from public.customers")).rows[0].n;
    const beforeInvoices=(await db.query('select count(*)::int n from public.invoices')).rows[0].n;
    await db.query(dupMigration);
    assert.equal((await db.query('select count(*)::int n from public.customers')).rows[0].n,before);
    assert.equal((await db.query('select count(*)::int n from public.invoices')).rows[0].n,beforeInvoices);
  });
  const createWith=(c,b,key,email,phone,gstin)=>c.query("select public.create_customer_once($1,$2,'Synthetic',null,$3,$4,$5,null) result",[b,key,email,phone,gstin]);
  await test('shared contact and GSTIN identifiers are preserved including archived records',async()=>{
    const key=randomUUID();const first=await as(ids.manager,c=>createWith(c,ids.a,key,' Buyer@Example.invalid ','+91 12345-67890','27ABCDE1234F1Z5'));
    const id=first.rows[0].result.customer_id;assert.equal((await as(ids.manager,c=>createWith(c,ids.a,key,' Buyer@Example.invalid ','+91 12345-67890','27ABCDE1234F1Z5'))).rows[0].result.replayed,true);
    await db.query('update public.customers set is_archived=true where id=$1',[id]);
    const shared=await as(ids.manager,c=>createWith(c,ids.a,randomUUID(),'buyer@example.invalid','911234567890','27abcde1234f1z5'));
    assert.notEqual(shared.rows[0].result.customer_id,id);
    const count=(await db.query("select count(*)::int n from public.customers where business_id=$1 and lower(btrim(email))='buyer@example.invalid'",[ids.a])).rows[0].n;assert.ok(count>=2);
    const matches=(await db.query("select count(*)::int n from public.customers where id=any($1::uuid[]) and lower(btrim(email))='buyer@example.invalid' and regexp_replace(phone,'[^0-9]','','g')='911234567890' and upper(btrim(gstin))='27ABCDE1234F1Z5'",[[id,shared.rows[0].result.customer_id]])).rows[0].n;assert.equal(matches,2);

    await as(ids.ownerB,c=>createWith(c,ids.b,randomUUID(),'buyer@example.invalid',null,null));
    await as(ids.manager,c=>fails(()=>c.query("insert into public.customers(business_id,name) values($1,'legacy direct insert')",[ids.a]),['42501']));
    await as(ids.manager,c=>fails(()=>c.query("update public.customers set edit_version=1 where business_id=$1 and id=$2",[ids.a,id]),['42501']));
    await as(ids.manager,c=>createWith(c,ids.a,randomUUID(),null,null,null));
    await as(ids.manager,c=>createWith(c,ids.a,randomUUID(),'   ','   ',null));
  });
  await test('different keys permit shared contacts but concurrent same key still creates one',async()=>{
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {
      const rows=await Promise.all(clients.map(c=>as(ids.manager,cl=>createWith(cl,ids.a,randomUUID(),'race@example.invalid',null,null),c)));assert.notEqual(rows[0].rows[0].result.customer_id,rows[1].rows[0].result.customer_id);
      const key=randomUUID();const same=await Promise.all(clients.map(c=>as(ids.manager,cl=>createWith(cl,ids.a,key,'same@example.invalid',null,null),c)));assert.equal(same[0].rows[0].result.customer_id,same[1].rows[0].result.customer_id);assert.deepEqual(same.map(r=>r.rows[0].result.replayed).sort(),[false,true]);
      await as(ids.manager,c=>fails(()=>createWith(c,ids.a,key,'different@example.invalid',null,null),['22023']));
    } finally {await Promise.all(clients.map(c=>c.end()));}
  });

  await db.query(await readFile('supabase/migrations/20261107001400_customer_update_audit.sql','utf8'));
  await test('migration function ownership, hardened search path and runtime grants match mock assumptions',async()=>{
    const signatures=['public.update_customer_if_version(uuid,uuid,integer,text,text,text,text,text,text)','public.create_customer_once(uuid,uuid,text,text,text,text,text,text)','paidflow_private.audit_customer_update()'];
    for(const sig of signatures){const r=(await db.query("select p.prosecdef, p.proconfig, (r.rolsuper or r.rolbypassrls) bypass from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=to_regprocedure($1)",[sig])).rows[0];assert.equal(r.prosecdef,true);assert.equal(r.bypass,true);assert.ok(r.proconfig.includes('search_path=pg_catalog, pg_temp'));}
    const priv=(await db.query("select has_table_privilege('authenticated','public.customers','INSERT') ins,has_column_privilege('authenticated','public.customers','name','UPDATE') upd,has_table_privilege('authenticated','public.activity_logs','INSERT,UPDATE,DELETE') audit_write")).rows[0];assert.deepEqual(priv,{ins:false,upd:false,audit_write:false});
  });

  await test('customer create and material updates audit actor without contact values',async()=>{
    const created=await as(ids.manager,c=>createWith(c,ids.a,randomUUID(),'audit@example.invalid',null,null));const id=created.rows[0].result.customer_id;
    await as(ids.manager,async c=>{await customerEdit(c,ids.a,id,1,'Edited');await customerEdit(c,ids.a,id,2,'Edited');await fails(()=>customerEdit(c,ids.a,id,1,'Stale'),['40001']);});
    const rows=(await db.query('select actor_user_id,action,metadata from public.activity_logs where business_id=$1 and entity_type=$2 and entity_id=$3 order by created_at,id',[ids.a,'customer',id])).rows;
    assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.action).sort(),['customer.created','customer.updated']);for(const row of rows) assert.equal(row.actor_user_id,ids.manager);assert.deepEqual(rows.find(r=>r.action==='customer.created').metadata,{});assert.deepEqual(rows.find(r=>r.action==='customer.updated').metadata,{changed_fields:['name','email']});
    await db.query("update public.customers set name='Maintenance' where id=$1",[id]);
    const last=(await db.query("select actor_user_id,metadata from public.activity_logs where entity_id=$1 and action='customer.updated' order by created_at desc,id desc limit 1",[id])).rows[0];assert.equal(last.actor_user_id,null);assert.deepEqual(last.metadata,{changed_fields:['name']});
    await db.query("update public.customers set whatsapp_phone='5551234567',billing_address=$2::jsonb,internal_notes='synthetic private note' where id=$1",[id,JSON.stringify({line:'synthetic address'})]);
    const direct=(await db.query("select business_id,entity_id,actor_user_id,metadata from public.activity_logs where entity_id=$1 and action='customer.updated' and metadata->'changed_fields' ? 'internal_notes'",[id])).rows[0];
    assert.deepEqual(direct,{business_id:ids.a,entity_id:id,actor_user_id:null,metadata:{changed_fields:['whatsapp_phone','billing_address','internal_notes']}});

  });

  await test('ordinary runtime cannot alter audit history and audit failure rolls back edit',async()=>{
    const id=(await as(ids.manager,c=>createWith(c,ids.a,randomUUID(),'audit-failure@example.invalid',null,null))).rows[0].result.customer_id;
    await as(ids.manager,async c=>{
      await fails(()=>c.query("insert into public.activity_logs(business_id,entity_type,entity_id,action) values($1,'customer',$2,'fake')",[ids.a,id]),['42501']);
      await fails(()=>c.query("update public.activity_logs set action='fake' where entity_id=$1",[id]),['42501']);
      await fails(()=>c.query('delete from public.activity_logs where entity_id=$1',[id]),['42501']);
    });
    await db.query("create function paidflow_private.test_audit_abort() returns trigger language plpgsql as $$ begin if NEW.action='customer.updated' then raise exception 'synthetic audit failure'; end if; return NEW; end $$; create trigger test_audit_abort before insert on public.activity_logs for each row execute function paidflow_private.test_audit_abort()");
    try {await as(ids.manager,c=>fails(()=>customerEdit(c,ids.a,id,1,'Must rollback'),['P0001']));const r=(await db.query('select name,edit_version from public.customers where id=$1',[id])).rows[0];assert.deepEqual(r,{name:'Synthetic',edit_version:1});} finally {await db.query('drop trigger test_audit_abort on public.activity_logs; drop function paidflow_private.test_audit_abort()');}
  });
  const legacyKey=randomUUID();const legacyCustomer=(await as(ids.manager,c=>createWith(c,ids.a,legacyKey,null,null,'29ABCDE1234F1Z5'))).rows[0].result.customer_id;
  await db.query(await readFile('supabase/migrations/20261107001500_customer_gstin_validation.sql','utf8'));
  await test('final replacement RPCs retain expected owner privileges and hardened search paths',async()=>{
    for(const sig of ['public.update_customer_if_version(uuid,uuid,integer,text,text,text,text,text,text)','public.create_customer_once(uuid,uuid,text,text,text,text,text,text)']){
      const row=(await db.query("select p.prosecdef,p.proconfig,(r.rolsuper or r.rolbypassrls) bypass,has_function_privilege('authenticated',p.oid,'EXECUTE') auth,has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=to_regprocedure($1)",[sig])).rows[0];
      assert.equal(row.prosecdef,true);assert.equal(row.bypass,true);assert.equal(row.auth,true);assert.equal(row.anon,false);assert.ok(row.proconfig.includes('search_path=pg_catalog, pg_temp'));
    }
  });
  await test('customer GSTIN synthetic checksum and supported state validation in create and edit RPCs',async()=>{
    assert.equal((await as(ids.manager,c=>createWith(c,ids.a,legacyKey,null,null,'29ABCDE1234F1Z5'))).rows[0].result.customer_id,legacyCustomer);
    for (const value of ['01ABCDE1234F1ZE','27ABCDE1234F1Z0','29ABCDE1234F1ZW','38ABCDE1234F1ZX']) assert.equal((await db.query('select paidflow_private.is_standard_customer_gstin($1) ok',[value])).rows[0].ok,true);
    for (const value of ['00ABCDE1234F1ZG','27ABCDE1234F1Z5','27XXXXXXXXXXXXX','BAD']) assert.equal((await db.query('select paidflow_private.is_standard_customer_gstin($1) ok',[value])).rows[0].ok,false);
    await as(ids.manager,async c=>{
      await fails(()=>createWith(c,ids.a,randomUUID(),null,null,'27ABCDE1234F1Z5'),['22023']);
      await fails(()=>c.query("select public.create_customer_once($1,$2,'x',null,null,null,'27ABCDE1234F1Z0','29')",[ids.a,randomUUID()]),['22023']);
      const created=(await createWith(c,ids.a,randomUUID(),null,null,'27ABCDE1234F1Z0')).rows[0].result.customer_id;
      await fails(()=>c.query("select public.update_customer_if_version($1,$2,1,'x',null,null,null,'27ABCDE1234F1Z5',null)",[ids.a,created]),['22023']);
    });
  });

  await test('shared cross-language GSTIN vectors match PostgreSQL validation',async()=>{
    const vectors=JSON.parse(await readFile('tests/unit/customer-gstin-vectors.json','utf8'));
    for(const {value,valid} of vectors) assert.equal((await db.query('select paidflow_private.is_standard_customer_gstin($1) ok',[value])).rows[0].ok,valid,value);
  });
  await db.query(await readFile('supabase/migrations/20261107001600_customer_compatibility_review.sql','utf8'));
  const patch=(c,b,id,v,p)=>c.query('select public.patch_customer_if_version($1,$2,$3,$4::jsonb) result',[b,id,v,JSON.stringify(p)]);
  await test('all customer patch fields use expected version and preserve unmentioned data',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,gstin,created_by) values($1,$2,'Patch legacy','27ABCDE1234F1Z5',$3)",[id,ids.a,ids.ownerA]);
    const payload={contact_person:'Desk',email:'desk@example.invalid',phone:'1234567890',whatsapp_phone:'1234567891',billing_address:{line:'synthetic'},shipping_address:{line:'other'},payment_terms_days:30,credit_limit_paise:10000,internal_notes:'private',is_archived:true};
    await as(ids.manager,async c=>{
      assert.equal((await patch(c,ids.a,id,1,payload)).rows[0].result.edit_version,2);
      await fails(()=>patch(c,ids.a,id,1,{name:'Stale'}),['40001']);
      assert.equal((await patch(c,ids.a,id,2,{is_archived:false,name:'Unarchived'})).rows[0].result.edit_version,3);
      await fails(()=>patch(c,ids.a,id,3,{edit_version:99}),['22023']);
      await fails(()=>patch(c,ids.a,id,3,{gstin:'27ABCDE1234F1Z5'}),['22023']);
      await fails(()=>patch(c,ids.a,id,3,{is_archived:'true'}),['22023']);
    });
    await as(ids.viewer,c=>fails(()=>patch(c,ids.a,id,3,{name:'Denied'}),['42501']));
    await as(ids.ownerB,c=>fails(()=>patch(c,ids.b,id,3,{name:'Denied'}),['40001']));
    const row=(await db.query('select name,gstin,is_archived,whatsapp_phone,billing_address,shipping_address,payment_terms_days,credit_limit_paise,internal_notes from public.customers where id=$1',[id])).rows[0];
    assert.deepEqual(row,{name:'Unarchived',gstin:'27ABCDE1234F1Z5',is_archived:false,whatsapp_phone:'1234567891',billing_address:{line:'synthetic'},shipping_address:{line:'other'},payment_terms_days:30,credit_limit_paise:'10000',internal_notes:'private'});
  });
  await test('patch rejects malformed SQL and JSON inputs without modifying customer',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,email,created_by) values($1,$2,'Patch adversary','original@example.invalid',$3)",[id,ids.a,ids.ownerA]);
    await as(ids.manager,async c=>{
      for(const value of [null,{},[],['name'],'string',42,{unknown:'value'},{name:null},{is_archived:null},{email:12},{phone:false},{billing_address:[]},{payment_terms_days:'1'},{credit_limit_paise:{}}]) await fails(()=>patch(c,ids.a,id,1,value),['22023']);
      await fails(()=>c.query('select public.patch_customer_if_version($1,$2,$3,NULL::jsonb)',[ids.a,id,1]),['22023']);
      await fails(()=>patch(c,ids.a,id,null,{name:'Invalid version'}),['22023']);
      for(const value of [{payment_terms_days:-1},{payment_terms_days:3651},{credit_limit_paise:-1},{credit_limit_paise:9007199254740992}]) await fails(()=>patch(c,ids.a,id,1,value),['23514']);
      await fails(()=>patch(c,ids.a,id,1,{payment_terms_days:1.2}),['22P02']);
      assert.equal((await patch(c,ids.a,id,1,{email:null})).rows[0].result.edit_version,2);
      assert.equal((await patch(c,ids.a,id,2,{name:'Patch adversary'})).rows[0].result.edit_version,3);
      await fails(()=>patch(c,ids.a,id,2,{name:'Stale'}),['40001']);
    });
    const row=(await db.query('select name,email,edit_version from public.customers where id=$1',[id])).rows[0];assert.deepEqual(row,{name:'Patch adversary',email:null,edit_version:3});
    assert.equal((await db.query("select count(*)::int n from public.activity_logs where entity_id=$1 and action='customer.updated'",[id])).rows[0].n,1);
  });
  await test('patch definer owner and grants are mock-only verified',async()=>{
    const r=(await db.query("select p.prosecdef,p.proconfig,(r.rolsuper or r.rolbypassrls) bypass,has_function_privilege('authenticated',p.oid,'EXECUTE') auth,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('public',p.oid,'EXECUTE') pub from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.patch_customer_if_version(uuid,uuid,integer,jsonb)'::regprocedure")).rows[0];
    assert.equal(r.prosecdef,true);assert.equal(r.bypass,true);assert.equal(r.auth,true);assert.equal(r.anon,false);assert.equal(r.pub,false);assert.ok(r.proconfig.includes('search_path=pg_catalog, pg_temp'));
  });
  await test('patch row lock forces a concurrent stale editor to wait and fail',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Lock fixture',$3)",[id,ids.a,ids.ownerA]);
    const a=new Client({connectionString:dburl.toString()}),b=new Client({connectionString:dburl.toString()});await a.connect();await b.connect();
    try {
      await a.query('begin');await a.query('set role authenticated');await a.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.manager]);
      await b.query('set role authenticated');await b.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.manager]);
      assert.equal((await patch(a,ids.a,id,1,{name:'First'})).rows[0].result.edit_version,2);
      const pending=patch(b,ids.a,id,1,{name:'Second'}).then(()=>({ok:true}),e=>({error:e}));
      let waiting=false;for(let n=0;n<100;n++){const r=await db.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query like '%patch_customer_if_version%'");if(r.rows[0].n){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(waiting);
      await a.query('commit');const result=await pending;assert.equal(result.error?.code,'40001');assert.equal((await db.query('select name from public.customers where id=$1',[id])).rows[0].name,'First');
    } finally {await a.query('rollback').catch(()=>{});await Promise.all([a.end(),b.end()]);}
  });
  await test('advisory rejects oversized inputs and never grants unauthorized probing',async()=>{
    const query=(c,e,p,g)=>c.query('select public.customer_duplicate_advisory($1,$2,$3,$4)',[ids.a,e,p,g]);
    await as(ids.manager,async c=>{for(const args of [['a'.repeat(255),null,null],[null,'1'.repeat(41),null],[null,null,'X'.repeat(16)]]) await fails(()=>query(c,...args),['22023']);});
    await as(ids.accountant,c=>fails(()=>query(c,'x@example.invalid',null,null),['42501']));
  });
  await test('advisory is tenant scoped, role limited, archived inclusive and presence only',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,email,phone,gstin,is_archived,created_by) values($1,$2,'Private',' Match@Example.invalid ','+91 98765-43210','27ABCDE1234F1Z0',true,$3)",[id,ids.a,ids.ownerA]);
    const lookup=(c,b,e,p,g)=>c.query('select public.customer_duplicate_advisory($1,$2,$3,$4) result',[b,e,p,g]);
    for(const args of [['match@example.invalid',null,null],[null,'919876543210',null],[null,null,'27abcde1234f1z0']]) assert.deepEqual((await as(ids.manager,c=>lookup(c,ids.a,...args))).rows[0].result,{possible_match:true});
    assert.deepEqual((await as(ids.manager,c=>lookup(c,ids.a,null,null,null))).rows[0].result,{possible_match:false});
    assert.deepEqual((await as(ids.ownerB,c=>lookup(c,ids.b,'match@example.invalid',null,null))).rows[0].result,{possible_match:false});
    await as(ids.viewer,c=>fails(()=>lookup(c,ids.a,'match@example.invalid',null,null),['42501']));
    await as(ids.ownerB,c=>fails(()=>lookup(c,ids.a,'match@example.invalid',null,null),['42501']));
  });
  await test('privileged disabling audit trigger suppresses audit and is not tamper proof',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Audit disabled fixture',$3)",[id,ids.a,ids.ownerA]);
    await db.query('alter table public.customers disable trigger audit_customer_update');
    try {await db.query("update public.customers set name='No audit' where id=$1",[id]);assert.equal((await db.query("select count(*)::int n from public.activity_logs where entity_id=$1 and action='customer.updated'",[id])).rows[0].n,0);}
    finally {await db.query('alter table public.customers enable trigger audit_customer_update');}
  });
  await test('financial snapshot honors RLS and pagination without leaking another tenant',async()=>{
    const get=(c,b,id,page=1)=>c.query('select public.customer_financial_snapshot($1,$2,$3) result',[b,id,page]);
    const result=(await as(ids.viewer,c=>get(c,ids.a,ids.ca))).rows[0].result;assert.ok(Array.isArray(result.balances));assert.ok(Array.isArray(result.payments));
    assert.equal((await as(ids.ownerB,c=>get(c,ids.a,ids.ca))).rows[0].result,null);
    assert.equal((await as(ids.viewer,c=>get(c,ids.a,ids.ca,0))).rows[0].result,null);
    assert.equal((await as(ids.viewer,c=>get(c,ids.a,ids.ca,2147483647))).rows[0].result,null);
    assert.equal((await as(ids.viewer,c=>get(c,ids.a,ids.ca,-2147483648))).rows[0].result,null);
  });
  await test('financial snapshot reproduces independent recorded ledger reconciliation and large-history cap',async()=>{
    const customer=(await db.query("select id from public.customers where business_id=$1 and name='Reconciliation fixture'",[ids.a])).rows[0].id;
    const result=(await as(ids.viewer,c=>c.query('select public.customer_financial_snapshot($1,$2,1) result',[ids.a,customer]))).rows[0].result;
    assert.equal(result.balance_count,2);assert.equal(result.balances.reduce((sum,r)=>sum+BigInt(r.balance_paise),0n),22000n);assert.equal(result.payment_count,5);
    const large=(await db.query("select id from public.customers where business_id=$1 and name='Large history fixture'",[ids.a])).rows[0].id;
    const lr=(await as(ids.viewer,c=>c.query('select public.customer_financial_snapshot($1,$2,1) result',[ids.a,large]))).rows[0].result;
    assert.equal(lr.balance_count,1001);assert.equal(lr.balances.length,1000);
  });
  await test('parallel patch operations reject stale versions across distinct customer fields',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Patch race',$3)",[id,ids.a,ids.ownerA]);
    const clients=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString:dburl.toString()});await c.connect();return c;}));
    try {const r=await Promise.allSettled(clients.map((c,i)=>as(ids.manager,cl=>patch(cl,ids.a,id,1,i?{is_archived:true}:{internal_notes:'synthetic'}),c)));assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.code,'40001');} finally {await Promise.all(clients.map(c=>c.end()));}
  });
  await test('financial snapshot preserves maximum integer paise as strings',async()=>{
    const result=(await as(ids.viewer,c=>c.query('select public.customer_financial_snapshot($1,$2,1) result',[ids.a,precisionCustomer]))).rows[0].result;
    assert.equal(result.balance_count,2);assert.deepEqual(result.balances.map(x=>x.balance_paise),['9007199254740991','9007199254740991']);assert.equal(result.balances.reduce((sum,x)=>sum+BigInt(x.balance_paise),0n),18014398509481982n);
  });
  await test('financial snapshot empty and >20000 payment pages use bounded exact results',async()=>{
    const id=randomUUID();await db.query("insert into public.customers(id,business_id,name,created_by) values($1,$2,'Empty snapshot',$3)",[id,ids.a,ids.ownerA]);
    const snapshot=(c,customer,page)=>c.query('select public.customer_financial_snapshot($1,$2,$3) result',[ids.a,customer,page]);
    const empty=(await as(ids.viewer,c=>snapshot(c,id,1000))).rows[0].result;assert.deepEqual(empty,{balance_count:0,balances:[],payment_count:0,payments:[]});
    await db.query("insert into public.payments(business_id,invoice_id,customer_id,payment_date,amount_paise,payment_mode,idempotency_key,recorded_by,status,voided_at,voided_by,voided_reason) select $1,$2,$3,'2026-05-01',1,'cash',gen_random_uuid(),$4,'voided',clock_timestamp(),$4,'Synthetic history' from generate_series(1,20001)",[ids.a,snapshotInvoice,snapshotCustomer,ids.manager]);
    await db.query('analyze public.payments');await db.query('analyze public.invoices');
    const start=performance.now();const result=(await as(ids.viewer,c=>snapshot(c,snapshotCustomer,1000))).rows[0].result;const elapsed=performance.now()-start;
    assert.equal(result.payment_count,20001);assert.equal(result.payments.length,20);assert.equal(new Set(result.payments.map(p=>p.id)).size,20);
    assert.equal((await as(ids.viewer,c=>snapshot(c,snapshotCustomer,1001))).rows[0].result,null);
    const plan=(await db.query("explain (analyze,buffers,format json) select id from public.payments where business_id=$1 and customer_id=$2 order by payment_date desc,id desc limit 20 offset 19980",[ids.a,snapshotCustomer])).rows[0]['QUERY PLAN'][0];
    const indexNames=[];const visit=p=>{if(p['Index Name']) indexNames.push(p['Index Name']);for(const child of p.Plans||[])visit(child);};visit(plan.Plan);console.log('PERFORMANCE synthetic snapshot page 1000 ms:',elapsed.toFixed(2),'payment-only plan ms:',plan['Execution Time'],'plan indexes:',JSON.stringify(indexNames),'; 20001 synthetic voided direct payment rows; deferred ledger trigger active');
    await db.query('delete from public.payments where customer_id=$1',[snapshotCustomer]);
  });
  await test('financial snapshot remains coherent when payment commits mid statement',async()=>{
    const customer=snapshotCustomer,id=snapshotInvoice;
    await db.query("create function paidflow_private.snapshot_test_gate() returns integer language plpgsql volatile as $$ begin perform pg_advisory_lock(85913); perform pg_advisory_unlock(85913); return 1; end $$; grant execute on function paidflow_private.snapshot_test_gate() to authenticated");
    const reader=new Client({connectionString:dburl.toString()});await reader.connect();await db.query('select pg_advisory_lock(85913)');
    try {
      await reader.query('set role authenticated');await reader.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids.viewer,JSON.stringify({sub:ids.viewer,role:'authenticated'})]);
      const pending=reader.query('select public.customer_financial_snapshot($1,$2,paidflow_private.snapshot_test_gate()) result',[ids.a,customer]);
      let waiting=false;for(let n=0;n<100;n++){const r=await db.query("select count(*)::int n from pg_stat_activity where wait_event='advisory' and query like '%snapshot_test_gate%'");if(r.rows[0].n){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(waiting);
      await as(ids.manager,c=>payment(c,ids.a,id,randomUUID(),1500));await db.query('select pg_advisory_unlock(85913)');
      const old=(await pending).rows[0].result;assert.equal(old.balances[0].balance_paise,'10000');assert.equal(old.payment_count,0);assert.deepEqual(old.payments,[]);
      const next=(await reader.query('select public.customer_financial_snapshot($1,$2,1) result',[ids.a,customer])).rows[0].result;assert.equal(next.balances[0].balance_paise,'8500');assert.equal(next.payment_count,1);assert.equal(next.payments[0].amount_paise,'1500');
    } finally {await db.query('select pg_advisory_unlock_all()');await reader.end();await db.query('drop function paidflow_private.snapshot_test_gate()');}
  });
  await test('financial snapshot remains coherent when payment is voided mid statement',async()=>{
    const customer=snapshotCustomer,id=snapshotInvoice;
    const paid=(await db.query("select id from public.payments where invoice_id=$1 and status='recorded'",[id])).rows[0].id;
    await db.query("create function paidflow_private.void_test_gate() returns integer language plpgsql volatile as $$ begin perform pg_advisory_lock(85914); perform pg_advisory_unlock(85914); return 1; end $$; grant execute on function paidflow_private.void_test_gate() to authenticated");
    const reader=new Client({connectionString:dburl.toString()});await reader.connect();await db.query('select pg_advisory_lock(85914)');
    try {
      await reader.query('set role authenticated');await reader.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids.viewer,JSON.stringify({sub:ids.viewer,role:'authenticated'})]);
      const pending=reader.query('select public.customer_financial_snapshot($1,$2,paidflow_private.void_test_gate()) result',[ids.a,customer]);
      let waiting=false;for(let n=0;n<100;n++){const r=await db.query("select count(*)::int n from pg_stat_activity where wait_event='advisory' and query like '%void_test_gate%'");if(r.rows[0].n){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(waiting);
      await as(ids.ownerA,c=>c.query("select public.void_payment($1,$2,'Synthetic void')",[ids.a,paid]));await db.query('select pg_advisory_unlock(85914)');
      const old=(await pending).rows[0].result;assert.equal(old.balances[0].balance_paise,'8500');assert.equal(old.payments[0].status,'recorded');
      const next=(await reader.query('select public.customer_financial_snapshot($1,$2,1) result',[ids.a,customer])).rows[0].result;assert.equal(next.balances[0].balance_paise,'10000');assert.equal(next.payments[0].status,'voided');
    } finally {await db.query('select pg_advisory_unlock_all()');await reader.end();await db.query('drop function paidflow_private.void_test_gate()');}
  });

} finally {
  await db.end();
  await admin.query(`DROP DATABASE IF EXISTS "${dbname}"`);
  await admin.end();
}
console.log(`\n${passed} local checks passed; ${failures} test errors; ${knownGaps} known vulnerabilities demonstrated (security acceptance FAIL). Standalone PostgreSQL with mock Supabase auth; not an actual Supabase integration test.`);
if (failures) process.exitCode=1;
