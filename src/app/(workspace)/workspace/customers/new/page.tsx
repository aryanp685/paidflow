import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CustomerForm } from "@/components/customers/customer-form";
import { getWorkspace } from "@/lib/supabase/guard";
import { canManageCustomers } from "@/lib/validation/customer";
import { notFound } from "next/navigation";
export default async function NewCustomerPage() {
  const { membership, business } = await getWorkspace();
  if (!canManageCustomers(membership.role)) notFound();
  return <><Link className="customer-back" href="/workspace/customers"><ArrowLeft size={15} /> Customers</Link><div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Add a customer</h1><p>Start with the details you have. You can edit them later.</p></div></div><CustomerForm key={business.id} businessId={business.id} /></>;
}
