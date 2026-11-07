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
    const supabase=await createClient();
    const {error}=await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response=NextResponse.redirect(new URL("/workspace",origin));
      response.cookies.delete("paidflow_recovery");
      return protect(response);
    }
  }
  return protect(NextResponse.redirect(new URL("/verify-email?error=expired",origin)));
}
