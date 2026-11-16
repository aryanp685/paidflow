import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus, ReceiptText } from "lucide-react";
import { getWorkspace } from "@/lib/supabase/guard";
import { isCompletePage } from "@/lib/data/pagination";
import { canManageCustomers } from "@/lib/validation/customer";
import { formatPaise } from "@/lib/financial/money";

const PAGE_SIZE = 50;
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { business, membership, supabase } = await getWorkspace();
  const params = await searchParams;
  const page = Math.min(typeof params.page === "string" && /^[1-9]\d{0,3}$/.test(params.page) ? Number(params.page) : 1, 1000);
  const { data, count, error } = await supabase.from("invoices").select("id,invoice_number,invoice_date,due_date,lifecycle_status,total_paise,balance_paise", { count: "exact" })
    .eq("business_id", business.id).eq("is_archived", false).order("invoice_date", { ascending: false }).order("id", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error || !isCompletePage(data, count, page, PAGE_SIZE) || count == null) throw new Error("Unable to load invoices. Please try again.");
  const invoices = data;
  return <><div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Invoices</h1><p>Review invoices recorded in this workspace.</p></div>{canManageCustomers(membership.role) && <Link className="customer-primary" href="/workspace/invoices/new"><Plus size={16} /> New draft</Link>}</div>
    <div className="invoice-notice" role="note"><strong>Drafts only on this screen.</strong> Issuing and GST invoicing require financial review before production use.</div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Your invoices</h2><p>{count} {count === 1 ? "invoice" : "invoices"} in this workspace</p></div><span><ReceiptText size={19} /></span></div>
      {invoices.length ? <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Date</th><th scope="col">Due date</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Balance</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{invoices.map(invoice => <tr key={invoice.id}><td><strong>{invoice.invoice_number}</strong></td><td>{invoice.invoice_date}</td><td>{invoice.due_date}</td><td><span className="invoice-status">{invoice.lifecycle_status}</span></td><td>{formatPaise(invoice.total_paise)}</td><td>{formatPaise(invoice.balance_paise)}</td><td><Link href={`/workspace/invoices/${invoice.id}`} aria-label={`View invoice ${invoice.invoice_number}`}>View</Link></td></tr>)}</tbody></table></div> : <div className="customer-empty"><ReceiptText size={25} /><h3>{page > 1 ? "No invoices on this page" : "No invoices yet"}</h3><p>{page > 1 ? "Go back to see earlier invoices." : "Invoices recorded for this workspace will appear here."}</p></div>}
      {(page > 1 || (page < 1000 && page * PAGE_SIZE < count)) && <nav className="customer-pagination" aria-label="Invoice pages">{page > 1 ? <Link href={`/workspace/invoices?page=${page - 1}`}><ArrowLeft size={14} /> Previous</Link> : <span />}<span>Page {page}</span>{page < 1000 && page * PAGE_SIZE < count && <Link href={`/workspace/invoices?page=${page + 1}`}>Next <ArrowRight size={14} /></Link>}</nav>}
      {page === 1000 && page * PAGE_SIZE < count && <p className="draft-help">Only the first 50,000 invoices are accessible here.</p>}
    </div></>;
}
