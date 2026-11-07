import { getStorageLab, sameOrigin, failure } from "@/lib/storage-lab/server";
import { getLab } from "@/lib/better-auth-lab/server";
import { withVerifiedBusiness } from "../../../../../better-auth-lab/core.mjs";
import { MAX_BYTES } from "../../../../../storage-lab/core.mjs";
export const dynamic="force-dynamic";
export async function GET(request: Request) {
  const storage=await getStorageLab(request.headers);if(!storage)return new Response("Not found",{status:404});
  try {const documents=await storage.list({headers:request.headers,businessId:new URL(request.url).searchParams.get("businessId")});return Response.json({documents},{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}
}
export async function POST(request: Request) {
  const storage=await getStorageLab(request.headers);if(!storage)return new Response("Not found",{status:404});if(!sameOrigin(request))return new Response("Forbidden",{status:403});
  const lab=await getLab();if(!lab)return new Response("Not found",{status:404});
  try {
    const businessId=request.headers.get("x-business-id"),area=request.headers.get("x-storage-area"),requestId=request.headers.get("x-request-id"),declared=request.headers.get("content-type");
    let name;try{name=decodeURIComponent(request.headers.get("x-file-name")??"");}catch{throw Error("INVALID_NAME");}
    await withVerifiedBusiness({auth:lab.auth,runtimePool:lab.runtimePool,headers:request.headers,businessId,allowedRoles:["owner","admin","manager"],work:async()=>null});
    const length=Number(request.headers.get("content-length")??0);if(!Number.isFinite(length)||length<0||length>MAX_BYTES)throw Error("INVALID_SIZE");
    if(!request.body)throw Error("INVALID_SIZE");const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error("INVALID_SIZE");}chunks.push(value);}
    const document=await storage.upload({headers:request.headers,businessId,area,name,declared,requestId,bytes:Buffer.concat(chunks)});return Response.json({document},{headers:{"Cache-Control":"no-store"}});
  }catch(e){return failure(e);}
}
