import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getWorkspace } from "@/lib/supabase/guard";
import { formatPaise } from "@/lib/financial/money";
import { canVoidPayments } from "@/lib/validation/payment";
import { VoidForm } from "@/components/payments/void-form";
export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }=await params;if(!z.uuid().safeParse(id).success) notFound();const { business,membership,supabase }=await getWorkspace();
  const { data:payment,error }=await supabase.from("payments").select("id,invoice_id,payment_date,amount_paise,payment_mode,reference_id,notes,status,voided_at,voided_reason").eq("business_id",business.id).eq("id",id).maybeSingle();
  if(error) throw new Error("Unable to load payment.");if(!payment) notFound();
  const { data:invoice,error:invoiceError }=await supabase.from("invoices").select("id,invoice_number").eq("business_id",business.id).eq("id",payment.invoice_id).maybeSingle();
  if(invoiceError || !invoice) throw new Error("Unable to load the payment invoice.");
  return <><Link className="customer-back" href="/workspace/payments"><ArrowLeft size={15} /> Payments</Link><div className="workspace-page-head"><div><div className="auth-kicker"><span /> PAYMENT RECORD</div><h1>{formatPaise(payment.amount_paise)}</h1><p>User-reported payment for invoice <Link className="dashboard-link" href={`/workspace/invoices/${invoice.id}`}>{invoice.invoice_number}</Link>.</p></div><span className="invoice-status">{payment.status}</span></div><div className="invoice-notice">This record is not independent payment verification. Voided records remain in history.</div><div className="customer-card"><div className="customer-card-head"><div><h2>Payment details</h2><p>Date: {payment.payment_date} · Mode: {payment.payment_mode.replaceAll("_"," ")}</p></div></div><dl className="payment-details"><div><dt>Reference</dt><dd>{payment.reference_id || "—"}</dd></div><div><dt>Notes</dt><dd>{payment.notes || "—"}</dd></div>{payment.status === "voided" && <><div><dt>Voided at</dt><dd>{payment.voided_at || "—"}</dd></div><div><dt>Void reason</dt><dd>{payment.voided_reason || "—"}</dd></div></>}</dl></div>{payment.status === "recorded" && canVoidPayments(membership.role) && <VoidForm businessId={business.id} paymentId={payment.id} />}</>;
}
