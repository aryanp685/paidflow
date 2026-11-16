import Link from "next/link";
import { CalendarClock, CircleDollarSign, ReceiptText, TriangleAlert } from "lucide-react";
import { getWorkspace } from "@/lib/supabase/guard";
import { formatPaise } from "@/lib/financial/money";
import { indiaDate } from "@/lib/financial/analytics";
import { loadInvoiceAnalytics, MAX_ANALYTICS_INVOICES } from "@/lib/financial/load-invoice-analytics";
export default async function AnalyticsPage() {
  const { business, supabase } = await getWorkspace();
  const today = indiaDate(new Date());
  const result = await loadInvoiceAnalytics(supabase, business.id, today);
  const header = <div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Analytics</h1><p>A summary of recorded invoice balances in this workspace.</p></div></div>;
  if (result.kind === "too-many") return <>{header}<div className="invoice-notice" role="alert">Analytics is unavailable for more than {MAX_ANALYTICS_INVOICES.toLocaleString("en-IN")} issued invoices. No partial totals are shown. <Link href="/workspace/invoices">View invoices instead →</Link></div></>;
  const { summary } = result;
  return <>{header}<div className="invoice-notice" role="note">Based on non-archived issued invoices as loaded, using their recorded balances. Overdue means due before {today} (India time); invoices due today are not overdue. Payments are user-reported and not independently verified. Data can change after loading.</div>
    <div className="dashboard-summary analytics-summary">
      <div className="dashboard-metric"><span><ReceiptText size={19} /></span><p>Issued invoices</p><strong>{summary.invoiceCount}</strong><small>Excludes drafts, cancelled and archived invoices</small></div>
      <div className="dashboard-metric"><span><CircleDollarSign size={19} /></span><p>Outstanding balance</p><strong>{formatPaise(summary.outstanding.toString())}</strong><small>{summary.outstandingCount} {summary.outstandingCount === 1 ? "invoice" : "invoices"} with a balance</small></div>
      <div className="dashboard-metric"><span><CalendarClock size={19} /></span><p>Overdue balance</p><strong>{formatPaise(summary.overdue.toString())}</strong><small>{summary.overdueCount} {summary.overdueCount === 1 ? "invoice" : "invoices"} overdue</small></div>
    </div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Outstanding by due date</h2><p>Only positive balances; amounts reflect recorded data, not verified collections.</p></div><span><TriangleAlert size={19} /></span></div><div className="customer-table-wrap"><table className="customer-table"><thead><tr><th scope="col">Age</th><th scope="col">Invoices</th><th scope="col">Balance</th></tr></thead><tbody>{summary.buckets.map(bucket => <tr key={bucket.label}><th scope="row">{bucket.label}</th><td>{bucket.count}</td><td><strong>{formatPaise(bucket.balance.toString())}</strong></td></tr>)}</tbody></table></div></div>
    <Link className="dashboard-link" href="/workspace/invoices">Review invoices →</Link>
  </>;
}
