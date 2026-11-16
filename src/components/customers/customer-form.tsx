"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { saveCustomer, checkCustomerDuplicates, type CustomerFormState, type DuplicateAdvisoryState } from "@/app/(workspace)/workspace/customers/actions";
import type { Customer } from "@/lib/supabase/database.types";

const initial: CustomerFormState = {};
export function CustomerForm({ customer, businessId }: { customer?: Customer; businessId: string }) {
  const [state, action, pending] = useActionState(saveCustomer, initial);
  const [advisory, setAdvisory] = useState<DuplicateAdvisoryState>({});
  const [checking, startCheck] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  function checkMatches() {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    startCheck(async () => { try { setAdvisory(await checkCustomerDuplicates({}, data)); } catch { setAdvisory({ error: "Could not check for possible matches. You can still save." }); } });
  }
  const [fields, setFields] = useState({ name: customer?.name ?? "", contactPerson: customer?.contact_person ?? "", email: customer?.email ?? "", phone: customer?.phone ?? "", gstin: customer?.gstin ?? "", stateCode: customer?.state_code ?? "" });
  const [requestId, setRequestId] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [confirmedReset, setConfirmedReset] = useState(false);
  const key = `paidflow.customer-create-request.${businessId}`;
  function begin() { try { let existing = sessionStorage.getItem(key); if (!existing) { existing = crypto.randomUUID(); sessionStorage.setItem(key, existing); } setRequestId(existing); setStorageError(false); } catch { setStorageError(true); } }
  function resetRequest() { if (!confirmedReset) return; try { const next = crypto.randomUUID(); sessionStorage.setItem(key, next); setRequestId(next); setConfirmedReset(false); setStorageError(false); } catch { setStorageError(true); } }
  useEffect(() => { if (!customer && state.success) { try { sessionStorage.removeItem(key); } catch { /* Committed; do not report a false failure. */ } } }, [customer, key, state.success]);
  if (!customer && !requestId) return <div className="customer-result"><h2>Prepare a customer</h2><p>Keep this tab open and retry the same details if saving is interrupted. Check the customer list before starting a new request.</p><button className="draft-add" type="button" onClick={begin}>Start customer →</button>{storageError && <p className="customer-error" role="alert">Session storage is unavailable. Enable it to safely retry this request.</p>}</div>;
  if (state.success) return <div className="customer-result" role="status"><h2>{customer ? "Customer updated" : state.replayed ? "Earlier request found" : "Customer added"}</h2><p>{state.replayed ? "An earlier create request was found; no new customer was created. The customer may have changed since then." : "Your changes have been saved to this workspace."}</p><Link href="/workspace/customers">Back to customers →</Link></div>;
  // React may reset a form after a resolved action even when it returns an error.
  // Preserve the displayed payload for deliberate retry; success replaces the form.
  return <form ref={formRef} action={action} className="customer-form" onReset={event => event.preventDefault()}>
    <input type="hidden" name="expectedBusinessId" value={businessId} />
    {customer ? <><input type="hidden" name="id" value={customer.id} /><input type="hidden" name="editVersion" value={customer.edit_version} /></> : <input type="hidden" name="requestId" value={requestId} />}
    <div className="customer-form-intro"><h2>{customer ? "Edit customer" : "Customer details"}</h2><p>Keep the essentials together. Only the customer name is required.</p></div>
    <div className="customer-fields">
      <label>Customer name <span>*</span><input name="name" required maxLength={200} value={fields.name} onChange={e => setFields(f => ({ ...f, name: e.target.value }))} autoComplete="organization" /></label>
      <label>Contact person<input name="contactPerson" maxLength={200} value={fields.contactPerson} onChange={e => setFields(f => ({ ...f, contactPerson: e.target.value }))} autoComplete="name" /></label>
      <label>Email address<input name="email" type="email" maxLength={254} value={fields.email} onChange={e => setFields(f => ({ ...f, email: e.target.value }))} autoComplete="email" /></label>
      <label>Phone number<input name="phone" type="tel" maxLength={40} value={fields.phone} onChange={e => setFields(f => ({ ...f, phone: e.target.value }))} autoComplete="tel" /></label>
      <label>GSTIN<input name="gstin" maxLength={15} value={fields.gstin} onChange={e => setFields(f => ({ ...f, gstin: e.target.value }))} placeholder="Optional" /><small>Standard PAN-based format and check digit only; registration is not verified.</small></label>
      <label>State code<input name="stateCode" maxLength={2} inputMode="numeric" value={fields.stateCode} onChange={e => setFields(f => ({ ...f, stateCode: e.target.value }))} placeholder="e.g. 27" /></label>
    </div>
    {!customer && <div><button type="button" onClick={checkMatches} disabled={pending || checking}>Check for possible matches</button>
      {advisory.error && <p role="status">{advisory.error}</p>}
      {advisory.checked && <p role="status">{advisory.possibleMatch ? "A possible match exists in this workspace, including archived customers. Shared details can be legitimate; review the customer list if useful." : "No match was found at the time of this check."} This check may become outdated and never blocks creation.</p>}
    </div>}
    {!customer && <><p className="draft-help">If saving is interrupted, retry the exact same details in this tab. The form data is not saved after a reload.</p><details className="customer-retry-reset"><summary>Start a different request</summary><p>First check the customer list. A new request can create a duplicate if the previous save succeeded.</p><label><input type="checkbox" checked={confirmedReset} onChange={e => setConfirmedReset(e.target.checked)} /> I checked the customer list and understand a new request can create a duplicate.</label><button type="button" onClick={resetRequest} disabled={!confirmedReset || pending}>Start a new request</button></details></>}
    {storageError && <p className="customer-error" role="alert">Session storage is unavailable. No new request was started.</p>}
    {state.error && <p className="customer-error" role="alert">{state.error}</p>}
    <div className="customer-form-actions"><Link href="/workspace/customers">Cancel</Link><button type="submit" disabled={pending || checking}>{pending ? "Saving…" : customer ? "Save changes" : "Add customer"}</button></div>
  </form>;
}
