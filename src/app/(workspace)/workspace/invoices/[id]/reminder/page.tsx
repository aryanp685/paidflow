import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getWorkspace } from "@/lib/supabase/guard";
import { canManageCustomers } from "@/lib/validation/customer";
import { formatPaise } from "@/lib/financial/money";
import { reminderTemplateVariants } from "@/lib/reminders/templates";
import { indiaDate } from "@/lib/financial/analytics";
import { ReminderComposer } from "@/components/reminders/reminder-composer";

export default async function ReminderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { business, membership, supabase } = await getWorkspace();
  if (!canManageCustomers(membership.role)) notFound();
  const { data: invoice, error } = await supabase.from("invoices").select("id,customer_id,invoice_number,due_date,balance_paise,lifecycle_status,is_archived").eq("business_id", business.id).eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load invoice for reminder.");
  if (!invoice || invoice.is_archived || invoice.lifecycle_status !== "issued" || invoice.balance_paise <= 0) notFound();
  const { data: customer, error: customerError } = await supabase.from("customers").select("name").eq("business_id", business.id).eq("id", invoice.customer_id).maybeSingle();
  if (customerError || !customer) throw new Error("Unable to load customer for reminder.");
  const asOf = indiaDate(new Date());
  const variants = reminderTemplateVariants({ customerName: customer.name, invoiceNumber: invoice.invoice_number, dueDate: invoice.due_date, balance: formatPaise(invoice.balance_paise), businessName: business.name }, asOf);
  return <><Link className="customer-back" href="/workspace/reminders"><ArrowLeft size={15} /> Collections</Link><div className="workspace-page-head"><div><div className="auth-kicker"><span /> MANUAL FOLLOW-UP</div><h1>Prepare reminder</h1><p>Invoice {invoice.invoice_number} · Balance at page load: {formatPaise(invoice.balance_paise)}</p></div></div>
    <div className="invoice-notice" role="note">Verify the customer, invoice and current balance before sharing. This draft is not saved and will not update if the balance or date changes. Date-specific drafts use the India date at page load.</div>
    <ReminderComposer templates={variants.general} variants={variants} />
  </>;
}
