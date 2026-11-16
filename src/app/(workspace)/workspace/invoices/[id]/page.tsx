import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getWorkspace } from "@/lib/supabase/guard";
import { canManageCustomers } from "@/lib/validation/customer";
import { canRecordPayments } from "@/lib/validation/payment";
import { formatPaise } from "@/lib/financial/money";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { business, membership, supabase } = await getWorkspace();
  const { data: invoice, error } = await supabase.from("invoices").select("id,business_id,customer_id,invoice_number,invoice_date,due_date,lifecycle_status,supply_type,is_gst_invoice,subtotal_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,shipping_paise,additional_charges_paise,round_off_paise,total_paise,paid_paise,balance_paise").eq("business_id", business.id).eq("id", id).eq("is_archived", false).maybeSingle();
  if (error) throw new Error("Unable to load invoice. Please try again.");
  if (!invoice) notFound();
  // Parent visibility is checked before querying its items; all queries also use
  // the server-selected tenant, and RLS independently enforces membership.
  const [customer, items] = await Promise.all([
    supabase.from("customers").select("name").eq("business_id", business.id).eq("id", invoice.customer_id).maybeSingle(),
    supabase.from("invoice_items").select("id,description,quantity,unit,unit_price_paise,discount_paise,gst_rate_bps,line_total_paise", { count: "exact" }).eq("business_id", business.id).eq("invoice_id", id).order("sort_order").order("id").limit(501),
  ]);
  if (customer.error || items.error || !customer.data || !items.data) throw new Error("Unable to load invoice details. Please try again.");
  // Do not show a partial set as the complete financial record.
  if (items.count === null || items.count > 500 || items.data.length !== items.count) throw new Error("Unable to display the complete invoice item list.");
  const amounts: [string, number][] = [["Subtotal", invoice.subtotal_paise], ["Discount", invoice.discount_paise], ["Taxable amount", invoice.taxable_paise], ["CGST", invoice.cgst_paise], ["SGST", invoice.sgst_paise], ["IGST", invoice.igst_paise], ["Shipping", invoice.shipping_paise], ["Additional charges", invoice.additional_charges_paise], ["Round off", invoice.round_off_paise], ["Total", invoice.total_paise], ["Paid", invoice.paid_paise], ["Balance", invoice.balance_paise]];
  return <><Link className="customer-back" href="/workspace/invoices"><ArrowLeft size={15} /> Invoices</Link><div className="workspace-page-head"><div><div className="auth-kicker"><span /> INVOICE DETAILS</div><h1>{invoice.invoice_number}</h1><p>Invoice details for {customer.data.name}.</p></div><div className="invoice-head-actions"><span className="invoice-status">{invoice.lifecycle_status}</span>{invoice.lifecycle_status === "issued" && invoice.balance_paise > 0 && canManageCustomers(membership.role) && <Link className="dashboard-link" href={`/workspace/invoices/${invoice.id}/reminder`}>Prepare reminder</Link>}{invoice.lifecycle_status === "issued" && canRecordPayments(membership.role) && <Link className="customer-primary" href={`/workspace/invoices/${invoice.id}/record-payment`}>Record payment</Link>}</div></div>
    <div className="invoice-notice" role="note">Invoice details cannot be edited here. This is not a tax-compliance or payment-verification certificate.</div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Invoice details</h2><p>Invoice date: {invoice.invoice_date} · Due date: {invoice.due_date} · Tax type: {invoice.supply_type.replaceAll("_", " ")}</p></div></div>
      <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Discount</th><th scope="col">GST rate</th><th scope="col">Line total</th></tr></thead><tbody>{items.data.map(item => <tr key={item.id}><td><strong>{item.description}</strong></td><td>{String(item.quantity)} {item.unit}</td><td>{formatPaise(item.unit_price_paise)}</td><td>{formatPaise(item.discount_paise)}</td><td>{Math.floor(item.gst_rate_bps / 100)}.{String(item.gst_rate_bps % 100).padStart(2, "0")}%</td><td>{formatPaise(item.line_total_paise)}</td></tr>)}</tbody></table></div>
      {!items.data.length && <div className="invoice-no-lines">No line items have been recorded.</div>}
      <dl className="invoice-totals">{amounts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatPaise(value)}</dd></div>)}</dl>
    </div></>;
}
