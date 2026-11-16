import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus, UsersRound } from "lucide-react";
import { getWorkspace } from "@/lib/supabase/guard";
import { isCompletePage } from "@/lib/data/pagination";
import { canManageCustomers } from "@/lib/validation/customer";

const PAGE_SIZE = 50;
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; q?: string | string[]; status?: string | string[] }> }) {
  const { business, membership, supabase } = await getWorkspace();
  const params = await searchParams;
  const page = Math.min(typeof params.page === "string" && /^[1-9]\d{0,3}$/.test(params.page) ? Number(params.page) : 1, 1000);
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const status = params.status === "archived" || params.status === "all" ? params.status : "active";
  if (q.length > 100 || /[\x00-\x1f\x7f]/.test(q)) throw new Error("Invalid search. Use at most 100 printable characters.");
  let query = supabase.from("customers").select("id,name,contact_person,email,phone,is_archived", { count: "exact" }).eq("business_id", business.id);
  if (status !== "all") query = query.eq("is_archived", status === "archived");
  // ILIKE is a parameter, not PostgREST expression syntax. Escape wildcard and
  // backslash so user text is a literal substring, not a match-all pattern.
  if (q) query = query.ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query.order("name").order("id").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error || !isCompletePage(data, count, page, PAGE_SIZE) || count == null) throw new Error("Unable to load customers. Please try again.");
  const canEdit = canManageCustomers(membership.role);
  const pageUrl = (n: number) => { const p = new URLSearchParams({ page: String(n), status }); if (q) p.set("q", q); return `/workspace/customers?${p}`; };
  return <>
    <div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Customers</h1><p>A clearer view of the people you work with.</p></div>{canEdit && <Link className="customer-primary" href="/workspace/customers/new"><Plus size={16} /> Add customer</Link>}</div>
    <form className="customer-search" method="get"><label>Search customer name<input name="q" type="search" defaultValue={q} maxLength={100} /></label><label>Status<select name="status" defaultValue={status}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All customers</option></select></label><button type="submit">Apply</button><Link href="/workspace/customers">Clear</Link></form>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Your customers</h2><p>{count} {count === 1 ? "customer" : "customers"} matching your filters</p></div><span><UsersRound size={19} /></span></div>
      {data.length ? <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th scope="col">Customer</th><th scope="col">Contact</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.map(customer => <tr key={customer.id}><td><strong>{customer.name}</strong></td><td>{customer.contact_person || "—"}</td><td>{customer.email || "—"}</td><td>{customer.phone || "—"}</td><td>{customer.is_archived ? "Archived" : "Active"}</td><td><Link href={`/workspace/customers/${customer.id}`} aria-label={`View ${customer.name}`}>View</Link></td></tr>)}</tbody></table></div> : <div className="customer-empty"><UsersRound size={25} /><h3>{page > 1 ? "No customers on this page" : q || status !== "active" ? "No matching customers" : "A fresh start"}</h3><p>{page > 1 ? "Go back to see earlier customers." : q || status !== "active" ? "Try a different search or filter." : canEdit ? "Add your first customer to start building your workspace." : "Customers added by your team will appear here."}</p>{canEdit && page === 1 && !q && status === "active" && <Link href="/workspace/customers/new">Add your first customer <ArrowRight size={15} /></Link>}</div>}
      {(page > 1 || (page < 1000 && page * PAGE_SIZE < count)) && <nav className="customer-pagination" aria-label="Customer pages">{page > 1 ? <Link href={pageUrl(page - 1)}><ArrowLeft size={14} /> Previous</Link> : <span />}<span>Page {page}</span>{page < 1000 && page * PAGE_SIZE < count && <Link href={pageUrl(page + 1)}>Next <ArrowRight size={14} /></Link>}</nav>}
      {page === 1000 && page * PAGE_SIZE < count && <p className="draft-help">Only the first 50,000 customers are accessible here.</p>}
    </div>
  </>;
}
