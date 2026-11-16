import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/customers/customer-form";
import { getWorkspace } from "@/lib/supabase/guard";
import { canManageCustomers } from "@/lib/validation/customer";
export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { membership, business, supabase } = await getWorkspace();
  if (!canManageCustomers(membership.role)) notFound();
  const { data, error } = await supabase.from("customers").select("id,business_id,name,contact_person,email,phone,gstin,state_code,is_archived,created_by,created_at,updated_at,edit_version").eq("business_id", business.id).eq("id", id).eq("is_archived", false).maybeSingle();
  if (error) throw new Error("Unable to load this customer.");
  if (!data) notFound();
  return <><Link className="customer-back" href={`/workspace/customers/${id}`}><ArrowLeft size={15} /> Customer details</Link><div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Edit customer</h1><p>Update this customer’s contact details.</p></div></div><CustomerForm key={`${business.id}:${data.id}`} customer={data} businessId={business.id} /></>;
}
