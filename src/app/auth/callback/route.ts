import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/env";

// Callback URLs contain one-time codes; discourage storage and referrer leakage.
function protect(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
export async function GET(request: NextRequest) {
  const origin=getSiteOrigin();
  if (!origin || !getSupabaseConfig()) return protect(new NextResponse("Authentication is not configured.",{status:503}));
  const code=request.nextUrl.searchParams.get("code");
  const flow=request.nextUrl.searchParams.get("flow");
  if (flow === "recovery") {
    const response=NextResponse.redirect(new URL("/forgot-password?error=unavailable",origin));
    response.cookies.delete("paidflow_recovery");
    return protect(response);
  }
  if (code) {
    // Modern supabase-js stores concurrent PKCE verifiers in separate slots.
    // In a server callback the SDK cannot read the URL itself; without this ID
    // it uses the most recent legacy verifier and may fail an earlier flow.
    // Flow IDs are opt-in in the SDK; this alone does not enable them.
    // This selects a verifier, NOT a provider-verified recovery purpose.
    const flowIds=request.nextUrl.searchParams.getAll("sb_flow_id");
    if (flowIds.length > 1 || (flowIds.length === 1 && !/^[a-zA-Z0-9_-]{8,64}$/.test(flowIds[0]))) {
      return protect(NextResponse.redirect(new URL("/verify-email?error=expired",origin)));
    }
    const supabase=await createClient();
    const {error}=flowIds.length === 1
      ? await supabase.auth.exchangeCodeForSession(code,{flowId:flowIds[0]})
      : await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response=NextResponse.redirect(new URL("/workspace",origin));
      response.cookies.delete("paidflow_recovery");
      return protect(response);
    }
  }
  return protect(NextResponse.redirect(new URL("/verify-email?error=expired",origin)));
}
