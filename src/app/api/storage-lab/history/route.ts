import { getStorageLab, failure } from "@/lib/storage-lab/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const storage=await getStorageLab(request.headers);
  if(!storage)return new Response("Not found",{status:404});
  try {
    const businessId=new URL(request.url).searchParams.get("businessId");
    const result=await storage.history({headers:request.headers,businessId});
    return Response.json(result,{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  } catch(e){return failure(e);}
}
