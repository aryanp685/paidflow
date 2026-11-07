// Local test-only S3rver wrapper. S3rver itself allows anonymous requests and does
// not verify SigV4 signatures, so an independent random header is mandatory.
import S3rver from 's3rver';
import Account from 's3rver/lib/models/account.js';
import { timingSafeEqual } from 'node:crypto';
import { realpath,stat } from 'node:fs/promises';
import path from 'node:path';
export async function startPrivateEmulator({directory,accessKeyId,secretAccessKey,token,port=0}) {
  if(!accessKeyId||!secretAccessKey||typeof token!=='string'||token.length<32||!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid emulator setup');
  const dir=await realpath(directory),info=await stat(dir),repo=path.resolve(process.cwd());
  if(dir===repo||dir.startsWith(repo+path.sep)||!info.isDirectory()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))throw Error('Emulator directory must be private and outside the repository');
  Account.DUMMY_ACCOUNT.revokeAccessKey('S3RVER');Account.DUMMY_ACCOUNT.createKeyPair(accessKeyId,secretAccessKey);
  const server=new S3rver({address:'127.0.0.1',port,directory:dir,silent:true,allowMismatchedSignatures:false,configureBuckets:[{name:'evidence'},{name:'payment-proofs'},{name:'ocr-staging'}]});
  server.middleware.unshift(async(ctx,next)=>{
    const supplied=Buffer.from(ctx.get('x-paidflow-emulator-token'));const expected=Buffer.from(token);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){ctx.status=403;return;}
    // The guarded endpoint supports only generated object keys and a tenant-
    // prefixed V2 list. Bucket changes, multipart, subresources and arbitrary
    // queries never reach S3rver. This narrows exposure; it does not patch it.
    const parts=ctx.path.split('/');const bucket=parts[1],keys=Object.keys(ctx.query);
    const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const object=parts.length===4&&new RegExp(`^${uuid}$`,'i').test(parts[2])&&new RegExp(`^${uuid}$`,'i').test(parts[3]);
    const listing=(parts.length===2||(parts.length===3&&parts[2]===''))&&ctx.method==='GET'&&ctx.query['list-type']==='2'&&typeof ctx.query.prefix==='string'&&new RegExp(`^${uuid}/$`,'i').test(ctx.query.prefix);
    const allowedObject=object&&['GET','HEAD','PUT','DELETE'].includes(ctx.method)&&keys.every(k=>k==='x-id');
    const allowedList=listing&&keys.every(k=>['x-id','list-type','prefix','continuation-token','max-keys','encoding-type'].includes(k));
    if(!['evidence','payment-proofs','ocr-staging'].includes(bucket)||(!allowedObject&&!allowedList)){ctx.status=403;return;}
    if(ctx.method==='PUT'){
      const length=ctx.get('content-length');
      if(!/^[0-9]+$/.test(length)||ctx.get('transfer-encoding')){ctx.status=411;return;}
      if(Number(length)<1||Number(length)>5*1024*1024){ctx.status=413;return;}
    }
    await next();
  });
  try {const address=await server.run();return {port:address.port,async close(){await server.close();Account.DUMMY_ACCOUNT.revokeAccessKey(accessKeyId);}};}catch(error){Account.DUMMY_ACCOUNT.revokeAccessKey(accessKeyId);throw error;}
}
