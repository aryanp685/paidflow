import { z } from "zod";

export const collectionWindows = ["overdue", "today", "next7", "all"] as const;
export type CollectionWindow = typeof collectionWindows[number];

/** Invalid or ambiguous query parameters cannot broaden a selected queue. */
export function parseCollectionWindow(value: string | string[] | undefined): CollectionWindow {
  if (value === undefined) return "overdue";
  if (typeof value !== "string" || !collectionWindows.includes(value as CollectionWindow)) throw new Error("Invalid collection filter.");
  return value as CollectionWindow;
}

/** The next-seven-days window includes today and the following six calendar days. */
export function collectionDates(today: string) {
  if (!z.iso.date().safeParse(today).success) throw new Error("Invalid collection date.");
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  const until = date.toISOString().slice(0, 10);
  if (!z.iso.date().safeParse(until).success) throw new Error("Invalid collection date.");
  return { today, until };
}

/** Reject malformed or out-of-window provider rows rather than presenting a misleading queue. */
export function validateCollectionRows(rows: { id: string; invoice_number: string; due_date: string; balance_paise: number | string }[], selected: CollectionWindow, today: string, until: string) {
  for (const row of rows) {
    if (!row || typeof row.invoice_number !== "string" || !row.invoice_number.trim() || !z.iso.date().safeParse(row.due_date).success) throw new Error("Invalid collection data.");
    const amount = row.balance_paise;
    if ((typeof amount !== "number" && typeof amount !== "string") || (typeof amount === "number" && (!Number.isSafeInteger(amount) || amount <= 0)) || (typeof amount === "string" && (!/^\d+$/.test(amount) || BigInt(amount) <= 0n || BigInt(amount) > 9007199254740991n))) throw new Error("Invalid collection data.");
    if ((selected === "overdue" && row.due_date >= today) || (selected === "today" && row.due_date !== today) || (selected === "next7" && (row.due_date < today || row.due_date > until))) throw new Error("Invalid collection data.");
  }
}
