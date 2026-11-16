import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { invoiceAnalytics } from "./analytics";

export const MAX_ANALYTICS_INVOICES = 1000;

/** One tenant-scoped bounded result. Never return a partial aggregate as a total. */
export async function loadInvoiceAnalytics(supabase: SupabaseClient<Database>, businessId: string, today: string) {
  const { data, count, error } = await supabase.from("invoices").select("id,due_date,balance_paise", { count: "exact" })
    .eq("business_id", businessId).eq("is_archived", false).eq("lifecycle_status", "issued")
    .order("id", { ascending: true }).range(0, MAX_ANALYTICS_INVOICES - 1);
  if (error || count == null || data === null) throw new Error("Unable to load analytics. Please try again.");
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Unable to verify analytics data.");
  if (count > MAX_ANALYTICS_INVOICES) return { kind: "too-many" as const };
  if (data.length !== count) throw new Error("Unable to load complete analytics data. Please try again.");
  return { kind: "ready" as const, summary: invoiceAnalytics(data, today) };
}
