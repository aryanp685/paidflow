import Link from "next/link";
import { ArrowLeft, ArrowRight, MessageSquareText } from "lucide-react";
import { getWorkspace } from "@/lib/supabase/guard";
import { isCompletePage } from "@/lib/data/pagination";
import { canManageCustomers } from "@/lib/validation/customer";
import { formatPaise } from "@/lib/financial/money";
import { indiaDate } from "@/lib/financial/analytics";
import { collectionDates, parseCollectionWindow, validateCollectionRows, type CollectionWindow } from "@/lib/collections/due-window";

const PAGE_SIZE = 50;
const filters: { value: CollectionWindow; label: string }[] = [
  { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" },
  { value: "next7", label: "Next 7 days" }, { value: "all", label: "All outstanding" },
];

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; due?: string | string[] }> }) {
  const { business, membership, supabase } = await getWorkspace();
  const allowed = canManageCustomers(membership.role);
  const params = await searchParams;
  const page = Math.min(typeof params.page === "string" && /^[1-9]\d{0,3}$/.test(params.page) ? Number(params.page) : 1, 1000);
  const selected = parseCollectionWindow(params.due);
  const { today, until } = collectionDates(indiaDate(new Date()));
  let result = null;
  if (allowed) {
    let query = supabase.from("invoices").select("id,invoice_number,due_date,balance_paise", { count: "exact" })
      .eq("business_id", business.id).eq("is_archived", false).eq("lifecycle_status", "issued").gt("balance_paise", 0);
    if (selected === "overdue") query = query.lt("due_date", today);
    if (selected === "today") query = query.eq("due_date", today);
    if (selected === "next7") query = query.gte("due_date", today).lte("due_date", until);
    result = await query.order("due_date", { ascending: true }).order("id", { ascending: true }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  }
  if (result && (result.error || !isCompletePage(result.data, result.count, page, PAGE_SIZE) || result.count == null)) throw new Error("Unable to load invoices for reminders. Please try again.");
  const invoices = result?.data ?? [];
  const count = result?.count ?? 0;
  validateCollectionRows(invoices, selected, today, until);
  const pageLink = (n: number) => `/workspace/reminders?due=${selected}&page=${n}`;
  return <>
    <div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Collections</h1><p>Find invoices to follow up and prepare a message for review.</p></div></div>
    <div className="invoice-notice" role="note">No messages are sent or scheduled by Paidflow. Drafts are not saved, and opening a messaging app does not confirm delivery. Check the current balance before sending.</div>
    {!allowed ? <div className="customer-result"><h2>Preparing reminders is restricted</h2><p>Only owners, admins and managers can prepare reminder messages.</p></div> : <div className="customer-card"><div className="customer-card-head"><div><h2>Invoices with a balance</h2><p>{count} {count === 1 ? "invoice" : "invoices"} in this filter · issued and not archived</p></div><span><MessageSquareText size={19} /></span></div>
      <nav className="collections-filters" aria-label="Collection due date filters">{filters.map(filter => <Link key={filter.value} href={`/workspace/reminders?due=${filter.value}`} aria-current={selected === filter.value ? "page" : undefined} className={selected === filter.value ? "selected" : ""}>{filter.label}</Link>)}</nav>
      <p className="collections-explanation">India date: {today}. Overdue means before today; next 7 days includes today through {until}. Counts and records may change after this page loads.</p>
      {invoices.length ? <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Due date</th><th scope="col">Balance</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{invoices.map(invoice => <tr key={invoice.id}><td><strong>{invoice.invoice_number}</strong></td><td>{invoice.due_date}</td><td>{formatPaise(invoice.balance_paise)}</td><td><Link href={`/workspace/invoices/${invoice.id}/reminder`} aria-label={`Prepare reminder for invoice ${invoice.invoice_number}`}>Prepare</Link></td></tr>)}</tbody></table></div> : <div className="customer-empty"><MessageSquareText size={25} /><h3>{page > 1 ? "No invoices on this page" : "No eligible invoices in this filter"}</h3><p>{page > 1 ? "Go back to see earlier invoices." : "Issued invoices with a balance will appear here."}</p></div>}
      {(page > 1 || (page < 1000 && page * PAGE_SIZE < count)) && <nav className="customer-pagination" aria-label="Reminder invoice pages">{page > 1 ? <Link href={pageLink(page - 1)}><ArrowLeft size={14} /> Previous</Link> : <span />}<span>Page {page}</span>{page < 1000 && page * PAGE_SIZE < count && <Link href={pageLink(page + 1)}>Next <ArrowRight size={14} /></Link>}</nav>}
      {page === 1000 && page * PAGE_SIZE < count && <p className="draft-help">Only the first 50,000 invoices in this filter are accessible here.</p>}
    </div>}
  </>;
}
