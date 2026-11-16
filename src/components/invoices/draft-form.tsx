"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { createInvoiceDraft, type DraftState } from "@/app/(workspace)/workspace/invoices/actions";

type Choice = { id: string; name: string };
const initial: DraftState = {};
export function DraftForm({ businessId, customers, today }: { businessId: string; customers: Choice[]; today: string }) {
  const [state, action, pending] = useActionState(createInvoiceDraft, initial);
  const [requestId, setRequestId] = useState("");
  const [details, setDetails] = useState({ customerId: "", invoiceDate: today, dueDate: today });
  const [rows, setRows] = useState([{ id: 0, description: "", quantity: "", unitPrice: "" }]);
  function updateRow(id: number, field: "description" | "quantity" | "unitPrice", value: string) {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row));
  }
  const [nextRow, setNextRow] = useState(1);
  const [storageError, setStorageError] = useState(false);
  const key = `paidflow.invoice-draft-request.${businessId}`;
  function beginDraft() {
    try {
      let existing = sessionStorage.getItem(key);
      if (!existing) { existing = crypto.randomUUID(); sessionStorage.setItem(key, existing); }
      setRequestId(existing); setStorageError(false);
    } catch { setStorageError(true); }
  }
  useEffect(() => {
    if (state.invoiceId) { try { sessionStorage.removeItem(key); } catch { /* Already saved; do not report a false failure. */ } }
  }, [key, state.invoiceId]);
  if (!requestId) return <div className="customer-result"><h2>Prepare a non-GST draft</h2><p>Keep this tab open while saving. You can safely retry the same details if a request is interrupted.</p><button className="draft-add" type="button" onClick={beginDraft}>Start draft →</button>{storageError && <p className="customer-error" role="alert">Session storage is unavailable. Enable it to safely retry this draft.</p>}</div>;
  if (state.invoiceId) return <div className="customer-result" role="status"><h2>Draft saved</h2><p>{state.replayed ? "Your earlier request was found; no duplicate was created." : "Your invoice is a draft and has not been issued or sent."}</p><Link href={`/workspace/invoices/${state.invoiceId}`}>View draft →</Link></div>;
  // React may reset a form after a resolved action even when it returns an error.
  // Preserve the displayed payload for deliberate retry; success replaces the form.
  return <form action={action} className="customer-form" onReset={event => event.preventDefault()}>
    <input type="hidden" name="expectedBusinessId" value={businessId} /><input type="hidden" name="requestId" value={requestId} />
    <div className="customer-form-intro"><h2>Non-GST draft</h2><p>No tax, discounts, shipping or additional charges are applied. Saving does not issue or send an invoice.</p></div>
    <div className="customer-fields"><label>Customer <span>*</span><select name="customerId" required value={details.customerId} onChange={e => setDetails(d => ({ ...d, customerId: e.target.value }))}><option value="" disabled>Select a customer</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label>Invoice date <span>*</span><input type="date" name="invoiceDate" value={details.invoiceDate} onChange={e => setDetails(d => ({ ...d, invoiceDate: e.target.value }))} required /></label><label>Due date <span>*</span><input type="date" name="dueDate" value={details.dueDate} onChange={e => setDetails(d => ({ ...d, dueDate: e.target.value }))} required /></label></div>
    <div className="draft-lines-head"><h3>Line items</h3><p>Up to 20 lines. Prices are in rupees; quantities support three decimal places.</p></div>
    {rows.map((row, index) => <fieldset className="draft-line" key={row.id}><legend>Line {index + 1}</legend><div className="customer-fields"><label>Description <span>*</span><input name="description" value={row.description} onChange={e => updateRow(row.id, "description", e.target.value)} maxLength={1000} required /></label><label>Quantity <span>*</span><input name="quantity" value={row.quantity} onChange={e => updateRow(row.id, "quantity", e.target.value)} inputMode="decimal" placeholder="e.g. 1.250" required /></label><label>Unit price (₹) <span>*</span><input name="unitPrice" value={row.unitPrice} onChange={e => updateRow(row.id, "unitPrice", e.target.value)} inputMode="decimal" placeholder="e.g. 100.00" required /></label></div>{rows.length > 1 && <button className="draft-remove" type="button" onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>Remove line</button>}</fieldset>)}
    {rows.length < 20 && <button className="draft-add" type="button" onClick={() => { setRows(current => [...current, { id: nextRow, description: "", quantity: "", unitPrice: "" }]); setNextRow(current => current + 1); }}>+ Add line</button>}
    <p className="draft-help">If saving is interrupted, retry the same details in this tab to avoid duplicates.</p>
    {storageError && <p className="customer-error" role="alert">Session storage is unavailable. Enable it to safely retry this draft.</p>}
    {state.error && <p className="customer-error" role="alert">{state.error}</p>}
    <div className="customer-form-actions"><Link href="/workspace/invoices">Cancel</Link><button disabled={pending || !requestId || storageError || !customers.length} type="submit">{pending ? "Saving…" : "Save draft"}</button></div>
  </form>;
}
