import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { DraftForm } from "@/components/invoices/draft-form";
import { getWorkspace } from "@/lib/supabase/guard";
import { canManageCustomers } from "@/lib/validation/customer";
export default async function NewInvoicePage() {
  const { membership, business, supabase } = await getWorkspace();
  if (!canManageCustomers(membership.role)) notFound();
  const { data, count, error } = await supabase.from("customers").select("id,name", { count: "exact" }).eq("business_id", business.id).eq("is_archived", false).order("name").order("id").limit(501);
  if (error || count === null || !data || data.length !== count || count > 500) throw new Error("Unable to load the complete customer list for a draft.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <><Link className="customer-back" href="/workspace/invoices"><ArrowLeft size={15} /> Invoices</Link><div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>New invoice draft</h1><p>Create a non-GST draft for review. Nothing is issued yet.</p></div></div>{data.length ? <DraftForm businessId={business.id} customers={data} today={today} /> : <div className="customer-result"><h2>Add a customer first</h2><p>A draft needs a customer from this workspace.</p><Link href="/workspace/customers/new">Add customer →</Link></div>}</>;
}
