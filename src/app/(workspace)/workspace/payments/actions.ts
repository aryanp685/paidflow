"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspace } from "@/lib/supabase/guard";
import { rupeesToPaise } from "@/lib/validation/invoice";
import { canRecordPayments, canVoidPayments, paymentSchema, voidPaymentSchema } from "@/lib/validation/payment";
export type PaymentState = { error?: string; paymentId?: string; replayed?: boolean; status?: string };
// Database responses are runtime data; an ambiguous response must not be
// rendered as a confirmed payment or void. A write may already have committed.
const paymentResult = z.object({ payment: z.object({ id: z.uuid(), invoice_id: z.uuid(), status: z.enum(["recorded", "voided"]) }), replayed: z.boolean() });
export async function recordPayment(_previous: PaymentState, form: FormData): Promise<PaymentState> {
  const parsed = paymentSchema.safeParse({ invoiceId: form.get("invoiceId"), requestId: form.get("requestId"), paymentDate: form.get("paymentDate"), mode: form.get("mode"), amount: form.get("amount"), reference: form.get("reference"), notes: form.get("notes") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Please check your payment details." };
  const { business, membership, supabase } = await getWorkspace();
  if (form.get("expectedBusinessId") !== business.id) return { error: "Your workspace changed. Reload and try again." };
  if (!canRecordPayments(membership.role)) return { error: "You do not have permission to record payments." };
  const v = parsed.data;
  // Never accept proof IDs from the client. The database's proof hold is a
  // separate required protection against callers bypassing this action.
  const { data, error } = await supabase.rpc("record_payment", { p_business_id: business.id, p_invoice_id: v.invoiceId, p_idempotency_key: v.requestId, p_amount_paise: Number(rupeesToPaise(v.amount)), p_payment_date: v.paymentDate, p_payment_mode: v.mode, p_reference_id: v.reference || null, p_proof_document_id: null, p_notes: v.notes || null });
  const result = paymentResult.safeParse(data);
  if (error || !result.success || result.data.payment.invoice_id !== v.invoiceId || (result.data.payment.status === "voided" && !result.data.replayed)) return { error: "Could not confirm payment. Check payment history and retry only with the same details and request." };
  revalidatePath("/workspace/payments"); revalidatePath(`/workspace/invoices/${v.invoiceId}`); revalidatePath("/workspace");
  return { paymentId: result.data.payment.id, replayed: result.data.replayed, status: result.data.payment.status };
}
export async function voidPayment(_previous: PaymentState, form: FormData): Promise<PaymentState> {
  const parsed = voidPaymentSchema.safeParse({ paymentId: form.get("paymentId"), reason: form.get("reason"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: "Enter a reason and confirm the void." };
  const { business, membership, supabase } = await getWorkspace();
  if (form.get("expectedBusinessId") !== business.id) return { error: "Your workspace changed. Reload and try again." };
  if (!canVoidPayments(membership.role)) return { error: "Only owners and admins can void payments." };
  const { data, error } = await supabase.rpc("void_payment", { p_business_id: business.id, p_payment_id: parsed.data.paymentId, p_reason: parsed.data.reason });
  const result = paymentResult.safeParse(data);
  if (error || !result.success || result.data.payment.id !== parsed.data.paymentId || result.data.payment.status !== "voided") return { error: "Could not confirm the void. Check payment history before retrying." };
  revalidatePath("/workspace/payments"); revalidatePath(`/workspace/payments/${result.data.payment.id}`); revalidatePath(`/workspace/invoices/${result.data.payment.invoice_id}`); revalidatePath("/workspace");
  return { paymentId: result.data.payment.id, replayed: result.data.replayed, status: result.data.payment.status };
}
