import { getStorageLab, sameOrigin, failure, auditRejection } from "@/lib/storage-lab/server";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const storage=await getStorageLab(request.headers);if(!storage)return new Response("Not found",{status:404});
  if(!sameOrigin(request))return auditRejection(storage,request.headers,"cleanup","origin");
  let delegated=false;
  try{const body=await request.json();if(typeof body?.businessId!=="string")throw Error("INVALID_INPUT");delegated=true;const result=await storage.cleanup({headers:request.headers,businessId:body.businessId});return Response.json(result,{headers:{"Cache-Control":"no-store"}});}
  catch(e){if(!delegated)await auditRejection(storage,request.headers,"cleanup","validation");return failure(e);}
}
