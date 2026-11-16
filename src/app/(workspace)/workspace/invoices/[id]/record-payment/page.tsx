import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PaymentForm } from "@/components/payments/payment-form";
import { getWorkspace } from "@/lib/supabase/guard";
import { canRecordPayments } from "@/lib/validation/payment";
import { formatPaise } from "@/lib/financial/money";
export default async function RecordPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const { business, membership, supabase } = await getWorkspace(); if (!canRecordPayments(membership.role)) notFound();
  const { data: invoice, error } = await supabase.from("invoices").select("id,invoice_number,balance_paise,lifecycle_status").eq("business_id", business.id).eq("id", id).eq("is_archived", false).maybeSingle();
  if (error) throw new Error("Unable to load invoice."); if (!invoice || invoice.lifecycle_status !== "issued") notFound();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <><Link className="customer-back" href={`/workspace/invoices/${id}`}><ArrowLeft size={15} /> Invoice</Link><div className="workspace-page-head"><div><div className="auth-kicker"><span /> PAYMENT RECORD</div><h1>Record payment</h1><p>{invoice.invoice_number} · Balance at page load: {formatPaise(invoice.balance_paise)}</p></div></div><div className="invoice-notice">The balance may change while this page is open. The database checks the current balance when saving.</div><PaymentForm businessId={business.id} invoiceId={id} today={today} /></>;
}
