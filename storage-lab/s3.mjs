import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

// Deliberately loopback-only: never accept an R2/cloud endpoint or credentials here.
export function createLocalS3({ endpoint, accessKeyId, secretAccessKey, emulatorToken }) {
  const u=new URL(endpoint);
  if(u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.pathname!=='/' || u.search || u.hash || !u.port || !accessKeyId || !secretAccessKey || typeof emulatorToken!=='string' || emulatorToken.length<32) throw new Error('Local emulator configuration required');
  const client=new S3Client({endpoint:u.origin,region:'auto',forcePathStyle:true,credentials:{accessKeyId,secretAccessKey},maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  client.middlewareStack.add((next)=>async args=>{args.request.headers['x-paidflow-emulator-token']=emulatorToken;return next(args);},{step:'build',name:'localPrivateEmulatorGuard'});
  return {
    async assertPrivate(){const response=await fetch(u.origin,{signal:AbortSignal.timeout(3000),redirect:'manual'});if(response.status!==403)throw Error('Local emulator must reject anonymous requests');},
    async put(area,key,bytes,mime){await client.send(new PutObjectCommand({Bucket:area,Key:key,Body:bytes,ContentType:mime}));},
    async get(area,key,max){const out=await client.send(new GetObjectCommand({Bucket:area,Key:key}));if(out.ContentLength>max){out.Body?.destroy?.();throw new Error('Stored object exceeds limit');}const chunks=[];let n=0;for await (const chunk of out.Body){n+=chunk.length;if(n>max){out.Body.destroy?.();throw new Error('Stored object exceeds limit');}chunks.push(chunk);}return Buffer.concat(chunks);},
    async delete(area,key){await client.send(new DeleteObjectCommand({Bucket:area,Key:key}));},
    async list(area,prefix){const all=[];let token;do{const page=await client.send(new ListObjectsV2Command({Bucket:area,Prefix:prefix,ContinuationToken:token,MaxKeys:1000}));all.push(...(page.Contents||[]).map(x=>x.Key).filter(Boolean));if(all.length>10000)throw new Error('Cleanup listing limit');token=page.IsTruncated?page.NextContinuationToken:undefined;if(page.IsTruncated&&!token)throw new Error('Incomplete object listing');}while(token);return all;},
    close(){client.destroy();}
  };
}
