import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { inspectPdf } from './pdf-inspection.mjs';
import { withActorTransaction } from '../neon/runtime/with-actor.mjs';
import { withVerifiedBusiness } from '../better-auth-lab/core.mjs';
export const MAX_BYTES=5*1024*1024;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const areas=['evidence','payment-proofs','ocr-staging'];
const uploadRoles=['owner','admin','manager'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function safeFilename(input){if(typeof input!=='string')throw Error('INVALID_NAME');const n=input.normalize('NFKC').replace(/[^A-Za-z0-9 ._-]/g,'_').replace(/^\.+/,'').trim().slice(0,180);if(!n||n==='.'||n==='..')throw Error('INVALID_NAME');return n;}
export async function inspect(bytes,declared){
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_BYTES)throw Error('INVALID_SIZE');
  const isPng=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  const isPdf=bytes.subarray(0,5).toString('ascii')==='%PDF-';
  const mime=isPng?'image/png':isJpeg?'image/jpeg':isPdf?'application/pdf':null;
  if(!mime||mime!==declared)throw Error('INVALID_TYPE');
  try {
    if(mime==='application/pdf') await inspectPdf(bytes);
    else {const image=sharp(bytes,{failOn:'warning',limitInputPixels:20_000_000});const metadata=await image.metadata();if(metadata.format!==(isPng?'png':'jpeg')||!metadata.width||!metadata.height)throw Error();await image.raw().toBuffer();}
  } catch {throw Error('INVALID_CONTENT');}
  return mime;
}
export function createStorageLab({auth,runtimePool,store,secret,clock=()=>Date.now()}) {
  if(typeof secret!=='string'||secret.length<32)throw Error('Secret required');
  async function session(headers){const s=await auth.api.getSession({headers});if(!s?.user?.emailVerified||!s?.user?.id||!s?.session?.id)throw Error('UNAUTHENTICATED');return s;}
  async function lock(db,id,action){if(!uuid.test(id||''))throw Error('FORBIDDEN');return (await db.query('select * from public.storage_lock($1,$2)',[id,action])).rows[0];}
  async function transition(db,id,state){return (await db.query('select * from public.storage_transition($1,$2)',[id,state])).rows[0];}
  function publicDoc(d){return {id:d.id,businessId:d.business_id,name:d.file_name,mime:d.mime_type,size:Number(d.file_size_bytes),area:d.storage_area,status:d.storage_status,createdAt:d.created_at};}
  async function doUpload({headers,businessId,area,name,declared,requestId,bytes},auditContext){
    if(!areas.includes(area)||!uuid.test(requestId||''))throw Error('INVALID_INPUT');
    // No unauthenticated or non-member upload reaches expensive parsers or storage.
    await withVerifiedBusiness({auth,runtimePool,headers,businessId,allowedRoles:uploadRoles,work:async()=>null});
    auditContext.businessId=businessId;
    const filename=safeFilename(name);const mime=await inspect(bytes,declared);const sha=digest(bytes);
    const docId=randomUUID(),key=`${businessId.toLowerCase()}/${randomUUID()}`;
    const d=await withVerifiedBusiness({auth,runtimePool,headers,businessId,allowedRoles:uploadRoles,work:async db=>(await db.query('select * from public.storage_register($1,$2,$3,$4,$5,$6,$7,$8,$9)',[businessId,docId,requestId,key,area,filename,mime,bytes.length,sha])).rows[0]});
    const s=await session(headers);
    return withActorTransaction(runtimePool,s.user.id,async db=>{
      const current=await lock(db,d.id,'write');if(['structurally_valid_unscanned','verified'].includes(current.storage_status))return publicDoc(current);
      if(current.storage_status!=='quarantine'||new Date(current.storage_expires_at).getTime()<=clock())throw Error('INVALID_STATE');
      await store.put(current.storage_area,current.storage_path,bytes,mime);
      const stored=await store.get(current.storage_area,current.storage_path,MAX_BYTES);
      if(stored.length!==bytes.length||digest(stored)!==sha)throw Error('STORAGE_MISMATCH');
      await inspect(stored,mime);
      return publicDoc(await transition(db,d.id,'structurally_valid_unscanned'));
    });
  }
  async function doList({headers,businessId}){return withVerifiedBusiness({auth,runtimePool,headers,businessId,allowedRoles:['owner','admin','manager','accountant','viewer'],work:async db=>(await db.query("select id,business_id,file_name,mime_type,file_size_bytes,storage_area,storage_status,created_at from public.documents where business_id=$1 and storage_status in ('quarantine','structurally_valid_unscanned','verified','deleting') order by created_at desc limit 200",[businessId])).rows.map(publicDoc)});}
  // Only a fixed set of successful document lifecycle events, never denials,
  // arbitrary metadata, filenames, credentials, object paths or file contents.
  async function history({headers,businessId}){
    const s=await session(headers);
    if(!uuid.test(businessId||''))throw Error('FORBIDDEN');
    return withActorTransaction(runtimePool,s.user.id,async db=>{
      const rows=(await db.query('select * from public.storage_document_history($1)',[businessId])).rows;
      return {events:rows.slice(0,100).map(r=>({id:r.event_id,actorId:r.actor_id,documentId:r.document_id,action:r.event_action,occurredAt:r.event_time})),hasMore:rows.length>100};
    });
  }
  async function tenantDenials({headers,businessId}){
    const s=await session(headers);
    if(!uuid.test(businessId||''))throw Error('FORBIDDEN');
    return withActorTransaction(runtimePool,s.user.id,async db=>{
      const rows=(await db.query('select * from public.storage_tenant_denials($1)',[businessId])).rows;
      return {events:rows.slice(0,100).map(r=>({id:String(r.event_id),actorId:r.actor_id,documentId:r.document_id,operation:r.operation,reason:r.reason,occurredAt:r.event_time})),hasMore:rows.length>100};
    });
  }
  function validate(token,id,sessionId){if(typeof token!=='string'||token.length>2048)throw Error('INVALID_GRANT');const pieces=token.split('.');if(pieces.length!==2)throw Error('INVALID_GRANT');const expected=createHmac('sha256',secret).update('paidflow-storage-grant-v1.'+pieces[0]+'.'+sessionId).digest();let actual,payload;try{actual=Buffer.from(pieces[1],'base64url');payload=JSON.parse(Buffer.from(pieces[0],'base64url').toString());}catch{throw Error('INVALID_GRANT');}if(actual.length!==expected.length||!timingSafeEqual(actual,expected)||payload.id!==id||!Number.isSafeInteger(payload.exp)||payload.exp<=clock()||payload.exp>clock()+60_000)throw Error('INVALID_GRANT');}
  // Interim security hold: no current status (including legacy "verified") carries a
  // trusted malware-scan attestation. Keep authentication and the database's read
  // authorization check, but never issue a grant or fetch bytes under this policy.
  // Write denial in its own transaction after the access transaction rolls back.
  // Only previously authorized targets may be attributed; the audit transaction
  // rechecks authorization and otherwise stores no target identifiers.
  // If the audit write fails, access still fails closed.
  async function anonymousDenial(operation,reason){
    await runtimePool.query('select public.storage_record_anonymous_denial($1,$2)',[operation,reason]);
  }
  async function actorDenial(s,operation,reason,context={}){
    const businessId=uuid.test(context.businessId||'')?context.businessId:null;
    const documentId=uuid.test(context.documentId||'')?context.documentId:null;
    if(businessId||documentId){
      await withActorTransaction(runtimePool,s.user.id,db=>db.query('select public.storage_record_context_denial($1,$2,$3,$4)',[operation,reason,businessId,documentId]));
    }else{
      await withActorTransaction(runtimePool,s.user.id,db=>db.query('select public.storage_record_access_denial($1,$2)',[operation,reason]));
    }
  }
  // A failed auth lookup cannot identify an actor or distinguish missing from expired.
  async function auditedSession(headers,operation){
    try {return await session(headers);}
    catch(error){await anonymousDenial(operation,error?.message==='UNAUTHENTICATED'?'unauthenticated':'auth_unavailable');throw error;}
  }
  async function audited(headers,operation,work){
    const s=await auditedSession(headers,operation);
    const context={};
    try {return await work(s,context);}
    catch(error){await actorDenial(s,operation,error?.message?.startsWith('INVALID_')?'validation':'access',context);throw error;}
  }
  // Route-level rejections never include selectors or request content. Origin
  // failures are intentionally anonymous: an attacker can cause them with a cookie.
  async function recordRequestDenial({headers,operation,reason}){
    if(reason==='origin')return anonymousDenial(operation,'origin');
    const s=await auditedSession(headers,operation);
    return actorDenial(s,operation,reason==='validation'?'validation':'access');
  }
  async function upload(input){return audited(input.headers,'upload',(_s,context)=>doUpload(input,context));}
  async function list(input){return audited(input.headers,'list',()=>doList(input));}
  async function grant({headers,id}){
    return audited(headers,'grant',(s,context)=>withActorTransaction(runtimePool,s.user.id,async db=>{await lock(db,id,'read');context.documentId=id;throw Error('NOT_AVAILABLE');}));
  }
  async function download({headers,id,grant:token,preview=false}){
    return audited(headers,preview?'preview':'download',async (s,context)=>{validate(token,id,s.session.id);return withActorTransaction(runtimePool,s.user.id,async db=>{await lock(db,id,'read');context.documentId=id;throw Error('NOT_AVAILABLE');});});
  }
  async function doRemove({headers,id},auditContext){const s=await session(headers);await withActorTransaction(runtimePool,s.user.id,async db=>{const d=await lock(db,id,'delete');auditContext.documentId=id;if(d.storage_status==='deleted'||d.storage_status==='deleting')return;if(!['structurally_valid_unscanned','verified','revoked'].includes(d.storage_status))throw Error('INVALID_STATE');await transition(db,id,'deleting');});return withActorTransaction(runtimePool,s.user.id,async db=>{const d=await lock(db,id,'delete');if(d.storage_status==='deleted')return;if(d.storage_status!=='deleting')throw Error('INVALID_STATE');await store.delete(d.storage_area,d.storage_path);await transition(db,id,'deleted');});}
  async function doCleanup({headers,businessId}){return withVerifiedBusiness({auth,runtimePool,headers,businessId,allowedRoles:['owner','admin'],work:async db=>{await db.query('select public.storage_authorize_cleanup($1)',[businessId]);let cleaned=0;const rows=(await db.query("select id from public.documents where business_id=$1 and ((storage_status='quarantine' and storage_expires_at<=now()) or storage_status='deleting')",[businessId])).rows;for(const row of rows){const d=await lock(db,row.id,'delete');if(d.storage_status==='quarantine'&&new Date(d.storage_expires_at).getTime()<=clock()){await store.delete(d.storage_area,d.storage_path);await transition(db,d.id,'abandoned');cleaned++;}else if(d.storage_status==='deleting'){await store.delete(d.storage_area,d.storage_path);await transition(db,d.id,'deleted');cleaned++;}}
    for(const area of areas){for(const key of await store.list(area,`${businessId.toLowerCase()}/`)){if(!new RegExp(`^${businessId.toLowerCase()}/[0-9a-f-]{36}$`).test(key))continue;const existing=await db.query('select 1 from public.documents where business_id=$1 and storage_area=$2 and storage_path=$3 and storage_status not in ($4,$5)',[businessId,area,key,'deleted','abandoned']);if(!existing.rowCount){await store.delete(area,key);cleaned++;}}}return {cleaned};}});}
  async function remove(input){return audited(input.headers,'delete',(_s,context)=>doRemove(input,context));}
  async function cleanup(input){return audited(input.headers,'cleanup',()=>doCleanup(input));}
  return {upload,list,history,tenantDenials,grant,download,remove,cleanup,recordRequestDenial};
}
