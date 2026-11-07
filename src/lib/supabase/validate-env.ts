import { getSiteOrigin, getSupabaseConfig, isPublicSupabaseKey } from "./env";
/** Fail early for partial/unsafe configuration without including values in errors.
 * An entirely unconfigured instance remains available as a marketing preview. */
export function validatePublicEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url && !key) {
    if (process.env.NEXT_PUBLIC_SITE_URL && !getSiteOrigin()) throw new Error("Invalid NEXT_PUBLIC_SITE_URL; use a trusted origin without a path.");
    return;
  }
  if ([process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY].some((value) => value && !isPublicSupabaseKey(value))) throw new Error("Invalid public Supabase key. Never use a secret or service-role key.");
  if (!getSupabaseConfig()) throw new Error("Invalid or incomplete public Supabase configuration. Use a valid URL and a publishable or anon key; never use a secret or service-role key.");
  if (!getSiteOrigin()) throw new Error("NEXT_PUBLIC_SITE_URL must be a valid trusted app origin when Supabase is configured.");
}
