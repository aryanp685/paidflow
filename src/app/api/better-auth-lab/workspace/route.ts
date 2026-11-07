import { z } from "zod";
import { getLab, getLabSession, isLabHost } from "@/lib/better-auth-lab/server";
import { withActorTransaction } from "../../../../../neon/runtime/with-actor.mjs";
import { withVerifiedBusiness, createInitialBusiness } from "../../../../../better-auth-lab/core.mjs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if(!isLabHost(request.headers)) return new Response("Not found",{status:404});
  const lab=await getLab(); if (!lab) return new Response("Not found",{status:404});
  let session; try { session=await getLabSession(lab,request.headers); } catch { return Response.json({error:"Workspace temporarily unavailable."},{status:503,headers:{"Cache-Control":"no-store"}}); }
  if (!session?.user?.id || !session.user.emailVerified) return Response.json({error:"Sign in required."},{status:401,headers:{"Cache-Control":"no-store"}});
  const businessId=new URL(request.url).searchParams.get("businessId");
  try {
    if (businessId) {
      const result=await withVerifiedBusiness({auth:lab.auth,runtimePool:lab.runtimePool,headers:request.headers,businessId,allowedRoles:["owner","admin","manager","accountant","viewer"],work:async (_db: unknown,m: {role:string})=>({role:m.role})});
      return Response.json(result,{headers:{"Cache-Control":"no-store"}});
    }
    const rows=await withActorTransaction(lab.runtimePool,session.user.id,async (db: import("pg").PoolClient)=>{
      const result=await db.query("SELECT b.id,b.name,m.role FROM public.business_members m JOIN public.businesses b ON b.id=m.business_id WHERE m.user_id=$1 AND m.status='active' ORDER BY b.name",[session.user.id]);return result.rows;
    });
    return Response.json({businesses:rows},{headers:{"Cache-Control":"no-store"}});
  } catch { return Response.json({error:"Workspace unavailable."},{status:403,headers:{"Cache-Control":"no-store"}}); }
}

const inputSchema=z.object({
  key:z.string().uuid(), name:z.string().trim().min(1).max(200), legalName:z.string().trim().max(200).optional(),
  businessType:z.enum(["manufacturer","wholesaler","distributor","service","agency","other"]),
  address:z.string().trim().min(1).max(300), city:z.string().trim().min(1).max(100), district:z.string().trim().min(1).max(100),
  stateCode:z.string().regex(/^[0-9]{2}$/), pincode:z.string().regex(/^[0-9]{6}$/), gstRegistered:z.boolean(),
  gstin:z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/).optional(), invoicePrefix:z.string().regex(/^[A-Z0-9]{1,10}$/), termsDays:z.number().int().min(0).max(3650),
}).strict().refine(v=>v.gstRegistered ? !!v.gstin : !v.gstin);
export async function POST(request: Request) {
  if(!isLabHost(request.headers)) return new Response("Not found",{status:404});
  const lab=await getLab(); if(!lab) return new Response("Not found",{status:404});
  // Unlike Better Auth's own routes, this application endpoint enforces origin itself.
  if (request.headers.get("origin") !== process.env.PAIDFLOW_BA_LAB_ORIGIN || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({error:"Invalid request."},{status:403});
  let parsed; try { parsed=inputSchema.safeParse(await request.json()); } catch { return Response.json({error:"Invalid input."},{status:400}); }
  if (!parsed.success) return Response.json({error:"Invalid input."},{status:400});
  try { const {key,...input}=parsed.data; const id=await createInitialBusiness({auth:lab.auth,runtimePool:lab.runtimePool,headers:request.headers,input,key});return Response.json({id},{headers:{"Cache-Control":"no-store"}}); }
  catch(error) { const unauthenticated=error instanceof Error && error.message==="UNAUTHENTICATED";return Response.json({error:unauthenticated?"Sign in required.":"Unable to create workspace. Check your details and existing memberships."},{status:unauthenticated?401:400,headers:{"Cache-Control":"no-store"}}); }
}
