import { getStorageLab, sameOrigin, failure, auditRejection } from "@/lib/storage-lab/server";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function POST(request: Request,{params}:Context){
  const storage=await getStorageLab(request.headers);if(!storage)return new Response("Not found",{status:404});
  if(!sameOrigin(request))return auditRejection(storage,request.headers,"grant","origin");
  try{const result=await storage.grant({headers:request.headers,id:(await params).id});return Response.json(result,{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}
}
export async function GET(request: Request,{params}:Context){const storage=await getStorageLab(request.headers);if(!storage)return new Response("Not found",{status:404});try{const result=await storage.download({headers:request.headers,id:(await params).id,grant:request.headers.get("x-document-grant"),preview:new URL(request.url).searchParams.get("preview")==="1"});return new Response(new Uint8Array(result.bytes),{headers:{"Content-Type":result.mime,"Content-Disposition":`attachment; filename="${result.name.replace(/[^A-Za-z0-9._ -]/g,"_")}"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox","Referrer-Policy":"no-referrer"}});}catch(e){return failure(e);}}
export async function DELETE(request: Request,{params}:Context){
  const storage=await getStorageLab(request.headers);if(!storage)return new Response("Not found",{status:404});
  if(!sameOrigin(request))return auditRejection(storage,request.headers,"delete","origin");
  try{await storage.remove({headers:request.headers,id:(await params).id});return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}
}
