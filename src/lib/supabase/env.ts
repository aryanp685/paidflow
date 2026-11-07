/** Structural checks only; the Supabase server validates the key itself. */
export function isPublicSupabaseKey(key: string) {
  if (key.startsWith("sb_secret_")) return false;
  if (key.startsWith("sb_publishable_")) return key.length > "sb_publishable_".length;
  try {
    const parts = key.split(".");
    if (parts.length !== 3 || !parts.every(Boolean)) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "anon";
  } catch { return false; }
}
/** Public configuration only. Never use service-role credentials in this app. */
export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)))) return null;
    if (!isPublicSupabaseKey(key)) return null;
    return { url: parsed.toString().replace(/\/$/, ""), key };
  } catch { return null; }
}
export function getSiteOrigin() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;
  try { const u = new URL(raw); if (u.username || u.password || u.pathname !== "/" || u.search || u.hash || (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)))) return null; return u.origin; } catch { return null; }
}
