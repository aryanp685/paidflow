"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspace } from "@/lib/supabase/guard";
import { canManageCustomers, customerSchema } from "@/lib/validation/customer";

export type CustomerFormState = { error?: string; success?: boolean; replayed?: boolean };

export async function saveCustomer(_previous: CustomerFormState, form: FormData): Promise<CustomerFormState> {
  const rawId = form.get("id");
  const id = rawId === null || rawId === "" ? null : rawId;
  if (id !== null && !z.uuid().safeParse(id).success) return { error: "Invalid customer." };
  const requestId = form.get("requestId");
  if (id === null && !z.uuid().safeParse(requestId).success) return { error: "Invalid customer request. Reload and try again." };
  const parsed = customerSchema.safeParse({
    name: form.get("name"), contactPerson: form.get("contactPerson"), email: form.get("email"),
    phone: form.get("phone"), gstin: form.get("gstin"), stateCode: form.get("stateCode"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Please check your details." };
  const { supabase, business, membership } = await getWorkspace();
  if (form.get("expectedBusinessId") !== business.id) return { error: "Your workspace changed. Reload this page and try again." };
  if (!canManageCustomers(membership.role)) return { error: "You do not have permission to manage customers." };
  const value = parsed.data;
  const fields = { name: value.name, contact_person: value.contactPerson || null, email: value.email || null,
    phone: value.phone || null, gstin: value.gstin || null, state_code: value.stateCode || null };
  // The workspace comes only from the verified session, never from FormData.
  // Candidate RPCs enforce the tenant, role and concurrency checks in SQL.
  if (id) {
    const rawVersion = form.get("editVersion");
    if (typeof rawVersion !== "string" || !/^[1-9]\d{0,9}$/.test(rawVersion) || Number(rawVersion) > 2147483647) return { error: "Invalid edit request. Reload this customer." };
    const result = await supabase.rpc("update_customer_if_version", { p_business_id: business.id, p_customer_id: id as string, p_expected_version: Number(rawVersion), p_name: fields.name, p_contact_person: fields.contact_person, p_email: fields.email, p_phone: fields.phone, p_gstin: fields.gstin, p_state_code: fields.state_code });
    if (result.error?.code === "23505") return { error: "Could not save this customer due to a conflict. Check the customer list and try again." };
    if (result.error || !result.data?.customer_id) return { error: "Could not update this customer. It may have changed or access may have been lost. Reload and review before retrying." };
    revalidatePath("/workspace/customers");
    revalidatePath(`/workspace/customers/${id}`);
    return { success: true };
  }
  const result = await supabase.rpc("create_customer_once", { p_business_id: business.id, p_request_id: requestId as string, p_name: fields.name, p_contact_person: fields.contact_person, p_email: fields.email, p_phone: fields.phone, p_gstin: fields.gstin, p_state_code: fields.state_code });
  if (result.error?.code === "23505") return { error: "Could not save this customer due to a conflict. Check the customer list and try again." };
  if (result.error || !result.data?.customer_id) return { error: "Could not confirm the customer was saved. Retry the same details with this request, and check the customer list before starting a new one." };
  revalidatePath("/workspace/customers");
  return { success: true, replayed: result.data.replayed };
}

export type DuplicateAdvisoryState = { checked?: boolean; possibleMatch?: boolean; error?: string };
export async function checkCustomerDuplicates(_previous: DuplicateAdvisoryState, form: FormData): Promise<DuplicateAdvisoryState> {
  const raw = [form.get("email"), form.get("phone"), form.get("gstin")];
  if (raw.some(x => typeof x !== "string") || raw.some(x => (x as string).length > 254)) return { error: "Could not check for possible matches." };
  const [email, phone, gstin] = raw as string[];
  if (!email.trim() && !phone.replace(/\D/g, "") && !gstin.trim()) return { error: "Enter an email, phone or GSTIN to check." };
  const { supabase, business, membership } = await getWorkspace();
  if (form.get("expectedBusinessId") !== business.id || !canManageCustomers(membership.role)) return { error: "Could not check for possible matches." };
  const result = await supabase.rpc("customer_duplicate_advisory", { p_business_id: business.id, p_email: email || null, p_phone: phone || null, p_gstin: gstin || null });
  if (result.error || typeof result.data?.possible_match !== "boolean") return { error: "Could not check for possible matches. You can still save." };
  return { checked: true, possibleMatch: result.data.possible_match };
}
