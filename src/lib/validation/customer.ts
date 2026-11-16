import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max);
// Standard PAN-based GSTIN only. This checks the base-36 check digit, not
// registration status, ownership, state-code allocation or tax compliance.
export function isStandardGstin(value: string): boolean {
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(value) || !/^(0[1-9]|[12][0-9]|3[0-8])$/.test(value.slice(0, 2))) return false;
  let sum = 0, factor = 2;
  for (let i = 13; i >= 0; i--) {
    const product = parseInt(value[i], 36) * factor;
    sum += Math.floor(product / 36) + product % 36;
    factor = factor === 2 ? 1 : 2;
  }
  return (36 - sum % 36) % 36 === parseInt(value[14], 36);
}
export const customerSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required.").max(200),
  contactPerson: optionalText(200),
  email: z.string().trim().max(254).refine(value => !value || z.email().safeParse(value).success, "Enter a valid email address."),
  phone: z.string().trim().max(40).refine(value => !value || (/^[+\d ()-]+$/.test(value) && /^\+?[^+]*$/.test(value) && value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15), "Enter a valid phone number (7–15 digits)."),
  gstin: z.string().trim().toUpperCase().refine(value => !value || isStandardGstin(value), "Enter a valid standard PAN-based GSTIN and check digit."),
  stateCode: z.string().trim().refine(value => !value || /^(0[1-9]|[12][0-9]|3[0-8])$/.test(value), "Use a supported state code from 01 to 38."),
}).refine(value => !value.gstin || !value.stateCode || value.gstin.slice(0, 2) === value.stateCode, {
  path: ["gstin"], message: "GSTIN and state code must match.",
});
export type CustomerInput = z.infer<typeof customerSchema>;
export const customerWriters = ["owner", "admin", "manager"] as const;
export function canManageCustomers(role: string) { return (customerWriters as readonly string[]).includes(role); }
