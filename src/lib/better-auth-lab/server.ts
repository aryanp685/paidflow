import "server-only";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLabAuth } from "../../../better-auth-lab/core.mjs";

type Lab = { auth: ReturnType<typeof createLabAuth>; runtimePool: Pool };
let pending: Promise<Lab> | undefined;
function localDatabase(value: string | undefined, user: string) {
  if (!value) return false;
  try { const u = new URL(value); return ["postgres:", "postgresql:"].includes(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && decodeURIComponent(u.username) === user && !u.search && !u.hash; } catch { return false; }
}
async function localInbox(dir: string) {
  const resolved = await realpath(dir);
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd());
  const info = await stat(resolved);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`) || !info.isDirectory() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error("Test inbox must be a private directory outside the repository.");
  return resolved;
}
// The dev lab is not a preview-host or network service. This Host check is an
// additional guard, not a substitute for binding the dev server to loopback.
export function isLabHost(headers: Headers): boolean {
  try { return headers.get("host") === new URL(process.env.PAIDFLOW_BA_LAB_ORIGIN ?? "").host; } catch { return false; }
}
export async function getLab(): Promise<Lab | null> {
  if (process.env.NODE_ENV === "production" || process.env.PAIDFLOW_BA_LAB_ENABLED !== "1") return null;
  if (!pending) pending = initialize().catch(() => { pending=undefined; throw new Error("Local Better Auth lab unavailable."); });
  return pending;
}
// Do not let database-driver error objects escape into framework request logs.
export async function getLabSession(lab: Lab, headers: Headers) {
  try { return await lab.auth.api.getSession({ headers }); }
  catch { throw new Error("Local session unavailable."); }
}
async function initialize(): Promise<Lab> {
  const authUrl=process.env.PAIDFLOW_BA_LAB_AUTH_DB_URL, runtimeUrl=process.env.PAIDFLOW_BA_LAB_RUNTIME_DB_URL;
  const origin=process.env.PAIDFLOW_BA_LAB_ORIGIN, secret=process.env.PAIDFLOW_BA_LAB_SECRET, inbox=process.env.PAIDFLOW_BA_LAB_INBOX_DIR;
  if (!localDatabase(authUrl,"paidflow_auth_service") || !localDatabase(runtimeUrl,"paidflow_runtime") || !origin || !["http://localhost:3000","http://127.0.0.1:3000"].includes(origin) || !secret || secret.length < 32 || !inbox) throw new Error("Invalid local Better Auth lab configuration.");
  const dir=await localInbox(inbox);
  const authPool=new Pool({connectionString:authUrl}); const runtimePool=new Pool({connectionString:runtimeUrl});
  // pg emits idle-connection errors on the pool. Never dump Error/client objects,
  // which can include connection parameters, tokens, or backend cancellation data.
  authPool.on("error", () => console.error("Local auth database connection interrupted."));
  runtimePool.on("error", () => console.error("Local runtime database connection interrupted."));
  const auth=createLabAuth({ authPool, baseURL:origin, secret, mail:async (message: {kind:string;email:string;url:string}) => {
    // Local-only inbox: owner-only files; never served over HTTP or logged.
    await writeFile(path.join(dir, `${randomUUID()}.json`), JSON.stringify({kind:message.kind,email:message.email,url:message.url}), {mode:0o600,flag:"wx"});
  } });
  return {auth,runtimePool};
}
