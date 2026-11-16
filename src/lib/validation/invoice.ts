import { z } from "zod";

const MAX_PAISE = 9007199254740991n;
const quantityPattern = /^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$/;
const rupeePattern = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$/;
export function rupeesToPaise(value: string): bigint {
  if (!rupeePattern.test(value)) throw new Error("Enter a valid price with up to two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (paise > MAX_PAISE) throw new Error("Price is too large.");
  return paise;
}
function quantityThousandths(value: string): bigint {
  if (!quantityPattern.test(value)) throw new Error("Enter a valid quantity with up to three decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const qty = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (qty === 0n) throw new Error("Quantity must be greater than zero.");
  return qty;
}
const row = z.object({ description: z.string().trim().min(1).max(1000), quantity: z.string().trim(), unitPrice: z.string().trim() });
export const invoiceDraftSchema = z.object({
  requestId: z.uuid(), customerId: z.uuid(), invoiceDate: z.iso.date(), dueDate: z.iso.date(),
  lines: z.array(row).min(1).max(20),
}).superRefine((value, ctx) => {
  if (value.dueDate < value.invoiceDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date cannot be before invoice date." });
  let total = 0n;
  value.lines.forEach((line, index) => {
    try {
      const qty = quantityThousandths(line.quantity), price = rupeesToPaise(line.unitPrice);
      const amount = (qty * price + 500n) / 1000n;
      total += amount;
      if (amount > MAX_PAISE || total > MAX_PAISE) throw new Error("Invoice amount is too large.");
    } catch (error) { ctx.addIssue({ code: "custom", path: ["lines", index], message: error instanceof Error ? error.message : "Check this line." }); }
  });
  if (total === 0n && !ctx.issues.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "Invoice total must be greater than zero." });
});
