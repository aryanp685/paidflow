import Link from "next/link";
import { ArrowUpRight, ReceiptText, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import { getWorkspace } from "@/lib/supabase/guard";

export default async function WorkspacePage() {
  const { business, supabase } = await getWorkspace();
  // Counts are read directly from tenant-scoped rows. A query failure is not
  // turned into zero: that could mislead a business owner about their records.
  const [customers, invoices, payments] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("is_archived", false),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("is_archived", false).eq("lifecycle_status", "issued"),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "recorded"),
  ]);
  if (customers.error || invoices.error || payments.error ||
      ![customers.count, invoices.count, payments.count].every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) {
    throw new Error("Unable to load workspace overview. Please try again.");
  }
  return <>
    <div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Welcome to {business.name}.</h1><p>A simple view of your workspace, based on your records.</p></div><span className="workspace-ready"><span /> WORKSPACE CREATED</span></div>
    <div className="dashboard-summary">
      <Link href="/workspace/customers" className="dashboard-metric"><span><UsersRound size={19} /></span><p>Active customers</p><strong>{customers.count}</strong><small>View customers <ArrowUpRight size={13} /></small></Link>
      <div className="dashboard-metric"><span><ReceiptText size={19} /></span><p>Issued invoices</p><strong>{invoices.count}</strong><small>Non-archived issued invoices</small></div>
      <div className="dashboard-metric"><span><WalletCards size={19} /></span><p>Recorded payments</p><strong>{payments.count}</strong><small>Excludes voided payments</small></div>
    </div>
    <p className="draft-help">Counts are loaded separately and may change as records are updated.</p>
    <div className="workspace-info-grid"><div><span><UsersRound size={19} /></span><h3>Keep customers close</h3><p>Add and update the contacts your team works with.</p><Link className="dashboard-link" href="/workspace/customers">Go to customers <ArrowUpRight size={13} /></Link></div><div><span><ShieldCheck size={19} /></span><h3>Your business, your space</h3><p>Access is checked against your active workspace membership. Payment proofs remain unavailable.</p></div></div>
  </>;
}
