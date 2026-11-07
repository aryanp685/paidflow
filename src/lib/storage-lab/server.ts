import "server-only";
import { getLab, isLabHost } from "@/lib/better-auth-lab/server";
import { createLocalS3 } from "../../../storage-lab/s3.mjs";
import { createStorageLab } from "../../../storage-lab/core.mjs";
let pending: Promise<ReturnType<typeof createStorageLab> | null> | undefined;
export async function getStorageLab(headers: Headers) {
  if (!isLabHost(headers) || process.env.NODE_ENV === "production" || process.env.PAIDFLOW_STORAGE_LAB_ENABLED !== "1") return null;
  if(!pending) pending=initialize().catch(()=>{pending=undefined;throw new Error("Local storage lab unavailable.");});
  return pending;
}
async function initialize() {
  const lab=await getLab(); if(!lab) return null;
  const endpoint=process.env.PAIDFLOW_STORAGE_LAB_ENDPOINT,accessKeyId=process.env.PAIDFLOW_STORAGE_LAB_ACCESS_KEY,secretAccessKey=process.env.PAIDFLOW_STORAGE_LAB_SECRET_KEY,emulatorToken=process.env.PAIDFLOW_STORAGE_LAB_EMULATOR_TOKEN,secret=process.env.PAIDFLOW_BA_LAB_SECRET;
  if(!endpoint||!accessKeyId||!secretAccessKey||!emulatorToken||!secret)throw new Error("Invalid local storage lab configuration.");
  const store=createLocalS3({endpoint,accessKeyId,secretAccessKey,emulatorToken});
  try {await store.assertPrivate();return createStorageLab({auth:lab.auth,runtimePool:lab.runtimePool,store,secret});}catch(error){store.close();throw error;}
}
export function sameOrigin(request: Request) {return request.headers.get("origin") === process.env.PAIDFLOW_BA_LAB_ORIGIN;}
export function failure(error: unknown) {const code=error instanceof Error?error.message:"";return Response.json({error:code==="UNAUTHENTICATED"?"Sign in required.":"Request could not be completed. Check permissions, file and try again."},{status:code==="UNAUTHENTICATED"?401:code.startsWith("INVALID_")?400:403,headers:{"Cache-Control":"no-store"}});}
