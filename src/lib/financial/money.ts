/** Format integer paise without floating-point currency arithmetic. */
export function formatPaise(value: number | string): string {
  // Provider responses are runtime data: TypeScript alone cannot rule out
  // booleans or objects that BigInt would otherwise coerce into real amounts.
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Invalid monetary value");
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Invalid monetary value");
  if (typeof value === "string" && !/^-?\d+$/.test(value)) throw new Error("Invalid monetary value");
  const paise = BigInt(value);
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(absolute / 100n);
  return `${negative ? "−" : ""}₹${rupees}.${String(absolute % 100n).padStart(2, "0")}`;
}
