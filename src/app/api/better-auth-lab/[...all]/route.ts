import { getLab, isLabHost } from "@/lib/better-auth-lab/server";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  if (!isLabHost(request.headers)) return new Response("Not found", {status:404});
  const lab = await getLab();
  if (!lab) return new Response("Not found", {status:404});
  return lab.auth.handler(request);
}
export { handle as GET, handle as POST };
