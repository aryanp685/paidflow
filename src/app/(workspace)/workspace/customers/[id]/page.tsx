import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/supabase/guard";
import { canManageCustomers } from "@/lib/validation/customer";
import { isCompletePage } from "@/lib/data/pagination";
import { indiaDate, invoiceAnalytics } from "@/lib/financial/analytics";
import { formatPaise } from "@/lib/financial/money";

const SIZE = 20, MAX = 1000;
const pageNumber = (value: string | string[] | undefined) => Math.min(typeof value === "string" && /^[1-9]\d{0,3}$/.test(value) ? Number(value) : 1, 1000);
export default async function CustomerDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ invoices?: string | string[]; payments?: string | string[] }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { business, membership, supabase } = await getWorkspace();
  const { data: customer, error } = await supabase.from("customers").select("id,business_id,name,contact_person,email,phone,gstin,state_code,is_archived").eq("business_id", business.id).eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load this customer. Please try again.");
  if (!customer) notFound();
  const options: { invoices?: string | string[]; payments?: string | string[] } = await (searchParams ?? Promise.resolve({}));
  const ip = pageNumber(options.invoices), pp = pageNumber(options.payments);
  const [invoices, snapshot, activity] = await Promise.all([
    supabase.from("invoices").select("id,invoice_number,invoice_date,due_date,lifecycle_status,is_archived,total_paise,balance_paise", { count: "exact" }).eq("business_id", business.id).eq("customer_id", id).order("invoice_date", { ascending: false }).order("id", { ascending: false }).range((ip-1)*SIZE, ip*SIZE-1),
    supabase.rpc("customer_financial_snapshot", { p_business_id: business.id, p_customer_id: id, p_payment_page: pp }),
    supabase.from("activity_logs").select("id,action,created_at", { count: "exact" }).eq("business_id", business.id).eq("entity_type", "customer").eq("entity_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, SIZE-1),
  ]);
  const financial = snapshot.data;
  if (invoices.error || snapshot.error || activity.error || !financial || !isCompletePage(invoices.data, invoices.count, ip, SIZE) || !isCompletePage(financial.balances, financial.balance_count, 1, MAX) || !isCompletePage(financial.payments, financial.payment_count, pp, SIZE) || !isCompletePage(activity.data, activity.count, 1, SIZE) || invoices.count == null || activity.count == null) throw new Error("Unable to load complete customer records. Please try again.");
  const today = indiaDate(new Date());
  const summary = financial.balance_count > MAX ? null : invoiceAnalytics(financial.balances, today);
  const pageLink = (i: number, p: number) => `/workspace/customers/${id}?invoices=${i}&payments=${p}`;
  return <><Link className="customer-back" href="/workspace/customers"><ArrowLeft size={15} /> Customers</Link>
    <div className="workspace-page-head"><div><div className="auth-kicker"><span /> CUSTOMER DETAILS</div><h1>{customer.name}</h1><p>{customer.is_archived ? "Archived customer" : "Active customer"}</p></div>{!customer.is_archived && canManageCustomers(membership.role) && <Link className="customer-primary" href={`/workspace/customers/${id}/edit`}>Edit customer</Link>}</div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Contact details</h2><p>Details recorded in this workspace.</p></div></div><dl className="customer-details"><div><dt>Contact</dt><dd>{customer.contact_person || "—"}</dd></div><div><dt>Email</dt><dd>{customer.email || "—"}</dd></div><div><dt>Phone</dt><dd>{customer.phone || "—"}</dd></div><div><dt>GSTIN</dt><dd>{customer.gstin || "—"}</dd></div><div><dt>State code</dt><dd>{customer.state_code || "—"}</dd></div></dl></div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Outstanding and aging</h2><p>Non-archived issued invoices, using recorded balances as of loading. Balances and this page of payment history share one snapshot; invoice history is separate. Payments are user-reported, not verified. Due today is not overdue (India date {today}).</p></div></div>
      {summary ? <><div className="customer-details"><div>Outstanding: <strong>{formatPaise(summary.outstanding.toString())}</strong></div><div>Overdue: <strong>{formatPaise(summary.overdue.toString())}</strong></div></div><div className="customer-table-wrap"><table className="customer-table"><thead><tr><th scope="col">Age</th><th scope="col">Invoices</th><th scope="col">Balance</th></tr></thead><tbody>{summary.buckets.map(b => <tr key={b.label}><th scope="row">{b.label}</th><td>{b.count}</td><td>{formatPaise(b.balance.toString())}</td></tr>)}</tbody></table></div></> : <p className="customer-details" role="alert">Balance unavailable: more than 1,000 issued invoices. No partial total is shown.</p>}</div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Invoice history</h2><p>{invoices.count} records, including draft, cancelled and archived.</p></div></div>{invoices.data.length ? <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Total</th><th>Balance</th></tr></thead><tbody>{invoices.data.map(row => <tr key={row.id}><td>{row.is_archived ? row.invoice_number : <Link href={`/workspace/invoices/${row.id}`}>{row.invoice_number}</Link>}</td><td>{row.invoice_date}</td><td>{row.lifecycle_status}{row.is_archived ? " · archived" : ""}</td><td>{formatPaise(row.total_paise)}</td><td>{formatPaise(row.balance_paise)}</td></tr>)}</tbody></table></div> : <p className="customer-details">No invoices on this page.</p>}
      {(ip > 1 || (ip < 1000 && ip*SIZE < invoices.count)) && <nav className="customer-pagination" aria-label="Customer invoice pages">{ip > 1 ? <Link href={pageLink(ip-1,pp)}>Previous invoices</Link> : <span />}<span>Page {ip}</span>{ip < 1000 && ip*SIZE < invoices.count && <Link href={pageLink(ip+1,pp)}>Next invoices</Link>}</nav>}{ip === 1000 && ip*SIZE < invoices.count && <p className="draft-help">Only the first 20,000 invoices are accessible here.</p>}</div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Payment history</h2><p>{financial.payment_count} recorded and voided payments.</p></div></div>{financial.payments.length ? <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Status</th><th>Details</th></tr></thead><tbody>{financial.payments.map(row => <tr key={row.id}><td>{row.payment_date}</td><td>{formatPaise(row.amount_paise)}</td><td>{row.payment_mode.replaceAll("_", " ")}</td><td>{row.status}</td><td><Link href={`/workspace/payments/${row.id}`}>View</Link></td></tr>)}</tbody></table></div> : <p className="customer-details">No payments on this page.</p>}
      {(pp > 1 || (pp < 1000 && pp*SIZE < financial.payment_count)) && <nav className="customer-pagination" aria-label="Customer payment pages">{pp > 1 ? <Link href={pageLink(ip,pp-1)}>Previous payments</Link> : <span />}<span>Page {pp}</span>{pp < 1000 && pp*SIZE < financial.payment_count && <Link href={pageLink(ip,pp+1)}>Next payments</Link>}</nav>}{pp === 1000 && pp*SIZE < financial.payment_count && <p className="draft-help">Only the first 20,000 payments are accessible here.</p>}</div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Customer activity</h2><p>Latest customer-specific events only. Older edits and related invoice/payment events may not appear.</p></div></div>{activity.data.length ? <ul className="customer-details">{activity.data.map(row => <li key={row.id}>{row.action === "customer.created" ? "Customer created" : row.action === "customer.updated" ? "Customer updated" : "Customer event"} · {row.created_at}</li>)}</ul> : <p className="customer-details">No customer events recorded.</p>}{activity.count > SIZE && <p className="customer-details">Showing the latest {SIZE} of {activity.count} events.</p>}</div>
  </>;
}
