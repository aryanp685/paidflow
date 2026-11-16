import { z } from "zod";
import { rupeesToPaise } from "@/lib/validation/invoice";
export const paymentModes = ["upi", "neft", "rtgs", "imps", "bank_transfer", "cash", "cheque", "other"] as const;
export const paymentSchema = z.object({
  invoiceId: z.uuid(), requestId: z.uuid(), paymentDate: z.iso.date(), mode: z.enum(paymentModes),
  amount: z.string().trim(), reference: z.string().trim().max(200), notes: z.string().trim().max(500),
}).superRefine((value, ctx) => {
  try { if (rupeesToPaise(value.amount) === 0n) throw new Error("Amount must be greater than zero."); }
  catch (error) { ctx.addIssue({ code: "custom", path: ["amount"], message: error instanceof Error ? error.message : "Invalid amount." }); }
});
export const voidPaymentSchema = z.object({ paymentId: z.uuid(), reason: z.string().trim().min(1, "Enter a reason for voiding.").max(500), confirm: z.literal("yes") });
export function canRecordPayments(role: string) { return ["owner", "admin", "manager", "accountant"].includes(role); }
export function canVoidPayments(role: string) { return ["owner", "admin"].includes(role); }
