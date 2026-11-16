"use server";
import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/supabase/guard";
import { canManageCustomers } from "@/lib/validation/customer";
import { invoiceDraftSchema, rupeesToPaise } from "@/lib/validation/invoice";

export type DraftState = { error?: string; invoiceId?: string; replayed?: boolean };
export async function createInvoiceDraft(_previous: DraftState, form: FormData): Promise<DraftState> {
  const descriptions = form.getAll("description"), quantities = form.getAll("quantity"), prices = form.getAll("unitPrice");
  if (descriptions.length !== quantities.length || descriptions.length !== prices.length || descriptions.length > 20) return { error: "Please check your invoice lines." };
  const input = invoiceDraftSchema.safeParse({ requestId: form.get("requestId"), customerId: form.get("customerId"), invoiceDate: form.get("invoiceDate"), dueDate: form.get("dueDate"), lines: descriptions.map((description, i) => ({ description, quantity: quantities[i], unitPrice: prices[i] })) });
  if (!input.success) return { error: input.error.issues[0]?.message || "Please check your invoice details." };
  const { business, membership, supabase } = await getWorkspace();
  if (form.get("expectedBusinessId") !== business.id) return { error: "Your workspace changed. Reload and try again." };
  if (!canManageCustomers(membership.role)) return { error: "You do not have permission to create invoice drafts." };
  const value = input.data;
  const result = await supabase.rpc("create_non_gst_invoice_draft", { p_business_id: business.id, p_request_id: value.requestId,
    p_customer_id: value.customerId, p_invoice_date: value.invoiceDate, p_due_date: value.dueDate,
    p_lines: value.lines.map(line => ({ description: line.description, quantity: line.quantity, unitPricePaise: rupeesToPaise(line.unitPrice).toString() })) });
  if (result.error || !result.data?.invoice_id) return { error: "Could not save the draft. If retrying, keep the same details and try again." };
  revalidatePath("/workspace/invoices");
  return { invoiceId: result.data.invoice_id, replayed: result.data.replayed };
}
