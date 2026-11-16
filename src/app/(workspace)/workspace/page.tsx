import Link from "next/link";
import { ArrowUpRight, ReceiptText, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import { getWorkspace } from "@/lib/supabase/guard";
import { indiaDate } from "@/lib/financial/analytics";
import { formatPaise } from "@/lib/financial/money";
import { loadInvoiceAnalytics } from "@/lib/financial/load-invoice-analytics";

export default async function WorkspacePage() {
  const { business, supabase } = await getWorkspace();
  // Counts are read directly from tenant-scoped rows. A query failure is not
  // turned into zero: that could mislead a business owner about their records.
  const today = indiaDate(new Date());
  const [customers, invoices, payments, analytics] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("is_archived", false),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("is_archived", false).eq("lifecycle_status", "issued"),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "recorded"),
    loadInvoiceAnalytics(supabase, business.id, today),
  ]);
  if (customers.error || invoices.error || payments.error ||
      ![customers.count, invoices.count, payments.count].every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) {
    throw new Error("Unable to load workspace overview. Please try again.");
  }
  return <>
    <div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Welcome to {business.name}.</h1><p>A simple view of your workspace, based on your records.</p></div><span className="workspace-ready"><span /> WORKSPACE CREATED</span></div>
    {analytics.kind === "too-many" ? <div className="invoice-notice" role="alert">Receivables totals are unavailable for more than 1,000 issued invoices. No partial totals are shown. <Link href="/workspace/invoices">View invoices →</Link></div> : <>
      <div className="dashboard-summary">
        <div className="dashboard-metric"><span><WalletCards size={19} /></span><p>Outstanding balance</p><strong>{formatPaise(analytics.summary.outstanding.toString())}</strong><small>{analytics.summary.outstandingCount} invoices with a balance</small></div>
        <div className="dashboard-metric"><span><ReceiptText size={19} /></span><p>Overdue balance</p><strong>{formatPaise(analytics.summary.overdue.toString())}</strong><small>{analytics.summary.overdueCount} invoices due before {today}</small></div>
        <Link href="/workspace/reminders?due=next7" className="dashboard-metric"><span><ArrowUpRight size={19} /></span><p>Due in the next 7 days</p><strong>{formatPaise(analytics.summary.dueNext7.toString())}</strong><small>{analytics.summary.dueNext7Count} invoices · includes today</small></Link>
      </div>
      <p className="draft-help">Totals use one bounded result of non-archived issued invoice balances as of loading. Due today is not overdue; next 7 days includes today and the following six days (India time). <Link href="/workspace/analytics">View aging report →</Link> Payments are user-reported, not independently verified.</p>
    </>}
    <div className="dashboard-summary">
      <Link href="/workspace/customers" className="dashboard-metric"><span><UsersRound size={19} /></span><p>Active customers</p><strong>{customers.count}</strong><small>View customers <ArrowUpRight size={13} /></small></Link>
      <div className="dashboard-metric"><span><ReceiptText size={19} /></span><p>Issued invoices</p><strong>{invoices.count}</strong><small>Non-archived issued invoices</small></div>
      <div className="dashboard-metric"><span><WalletCards size={19} /></span><p>Recorded payments</p><strong>{payments.count}</strong><small>Excludes voided payments</small></div>
    </div>
    <p className="draft-help">Counts are loaded separately and may change as records are updated.</p>
    <div className="invoice-notice">Review invoices by due date in <Link href="/workspace/reminders"><strong>Collections →</strong></Link>. Follow-up drafts are manual and are not sent by PAIDFLOW.</div>
    <div className="workspace-info-grid"><div><span><UsersRound size={19} /></span><h3>Keep customers close</h3><p>Add and update the contacts your team works with.</p><Link className="dashboard-link" href="/workspace/customers">Go to customers <ArrowUpRight size={13} /></Link></div><div><span><ShieldCheck size={19} /></span><h3>Your business, your space</h3><p>Access is checked against your active workspace membership. Payment proofs remain unavailable.</p></div></div>
  </>;
}
