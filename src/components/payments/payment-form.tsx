"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { recordPayment, type PaymentState } from "@/app/(workspace)/workspace/payments/actions";
const initial: PaymentState = {};
export function PaymentForm({ businessId, invoiceId, today }: { businessId: string; invoiceId: string; today: string }) {
  const [state, action, pending] = useActionState(recordPayment, initial);
  const [fields, setFields] = useState({ amount: "", paymentDate: today, mode: "upi", reference: "", notes: "" });
  const [requestId, setRequestId] = useState(""); const [storageError, setStorageError] = useState(false);
  const key = `paidflow.payment-request.${businessId}.${invoiceId}`;
  function begin() { try { let existing = sessionStorage.getItem(key); if (!existing) { existing = crypto.randomUUID(); sessionStorage.setItem(key, existing); } setRequestId(existing); setStorageError(false); } catch { setStorageError(true); } }
  useEffect(() => { if (state.paymentId) { try { sessionStorage.removeItem(key); } catch { /* Already committed; do not report failure. */ } } }, [key, state.paymentId]);
  if (!requestId) return <div className="customer-result"><h2>Prepare a payment record</h2><p>This records a payment reported by you; it does not verify or transfer money. Keep this tab open to retry safely.</p><button className="draft-add" type="button" onClick={begin}>Start payment →</button>{storageError && <p className="customer-error" role="alert">Session storage is unavailable. Enable it to safely retry.</p>}</div>;
  if (state.paymentId) return <div className="customer-result" role="status"><h2>{state.replayed ? "Earlier payment found" : "Payment recorded"}</h2><p>{state.replayed && state.status === "voided" ? "The earlier payment is voided; no new payment was recorded." : state.replayed ? "Your earlier payment was found; no duplicate was created." : "The payment was recorded. It has not been independently verified."}</p><Link href={`/workspace/payments/${state.paymentId}`}>View payment →</Link></div>;
  // React may reset a form after a resolved action even when it returns an error.
  // Preserve the displayed payload for deliberate retry; success replaces the form.
  return <form action={action} className="customer-form" onReset={event => event.preventDefault()}><input type="hidden" name="expectedBusinessId" value={businessId} /><input type="hidden" name="invoiceId" value={invoiceId} /><input type="hidden" name="requestId" value={requestId} />
    <div className="customer-form-intro"><h2>Payment details</h2><p>Record a partial or full payment. Proof attachments are unavailable.</p></div>
    <div className="customer-fields"><label>Amount received (₹) <span>*</span><input name="amount" value={fields.amount} onChange={e => setFields(f => ({ ...f, amount: e.target.value }))} inputMode="decimal" placeholder="e.g. 1500.00" required /></label><label>Payment date <span>*</span><input type="date" name="paymentDate" value={fields.paymentDate} onChange={e => setFields(f => ({ ...f, paymentDate: e.target.value }))} required /></label><label>Payment mode <span>*</span><select name="mode" required value={fields.mode} onChange={e => setFields(f => ({ ...f, mode: e.target.value }))}><option value="upi">UPI</option><option value="neft">NEFT</option><option value="rtgs">RTGS</option><option value="imps">IMPS</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label><label>Reference<input name="reference" value={fields.reference} onChange={e => setFields(f => ({ ...f, reference: e.target.value }))} maxLength={200} placeholder="Optional" /></label><label>Notes<input name="notes" value={fields.notes} onChange={e => setFields(f => ({ ...f, notes: e.target.value }))} maxLength={500} placeholder="Optional" /></label></div>
    <p className="draft-help">If saving is interrupted, retry the exact same details in this tab. Check payment history before starting a new request.</p>
    {state.error && <p className="customer-error" role="alert">{state.error}</p>}
    <div className="customer-form-actions"><Link href={`/workspace/invoices/${invoiceId}`}>Cancel</Link><button type="submit" disabled={pending}>{pending ? "Recording…" : "Record payment"}</button></div>
  </form>;
}
