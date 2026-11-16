"use client";
import { useActionState } from "react";
import Link from "next/link";
import { voidPayment, type PaymentState } from "@/app/(workspace)/workspace/payments/actions";
const initial: PaymentState = {};
export function VoidForm({ businessId, paymentId }: { businessId: string; paymentId: string }) {
  const [state, action, pending] = useActionState(voidPayment, initial);
  if (state.paymentId) return <div className="customer-result" role="status"><h2>Payment voided</h2><p>{state.replayed ? "This payment was already voided." : "The original record remains in payment history."}</p><Link href="/workspace/payments">View payment history →</Link></div>;
  return <form action={action} className="customer-form"><input type="hidden" name="expectedBusinessId" value={businessId} /><input type="hidden" name="paymentId" value={paymentId} /><div className="customer-form-intro"><h2>Void payment</h2><p>The payment remains in history and the invoice balance is restored. This cannot be undone here.</p></div><div className="customer-fields"><label>Reason <span>*</span><input name="reason" required maxLength={500} /></label></div><label className="payment-confirm"><input type="checkbox" name="confirm" value="yes" required /> I understand this voids the payment record.</label>{state.error && <p className="customer-error" role="alert">{state.error}</p>}<div className="customer-form-actions"><button type="submit" disabled={pending}>{pending ? "Voiding…" : "Void payment"}</button></div></form>;
}
