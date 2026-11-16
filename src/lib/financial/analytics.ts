import { z } from "zod";

export type AnalyticsInvoice = { id: string; due_date: string; balance_paise: number | string };
export type AgingBucket = { label: string; count: number; balance: bigint };

/** Aggregate one complete tenant-scoped invoice result without float arithmetic. */
export function invoiceAnalytics(rows: AnalyticsInvoice[], today: string) {
  if (!z.iso.date().safeParse(today).success) throw new Error("Invalid analytics date");
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const seen = new Set<string>();
  const buckets: AgingBucket[] = [
    { label: "Not overdue (including today)", count: 0, balance: 0n },
    { label: "1–30 days overdue", count: 0, balance: 0n },
    { label: "31–60 days overdue", count: 0, balance: 0n },
    { label: "61–90 days overdue", count: 0, balance: 0n },
    { label: "91+ days overdue", count: 0, balance: 0n },
  ];
  let outstanding = 0n, overdue = 0n, outstandingCount = 0, overdueCount = 0;
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id || seen.has(row.id) || !z.iso.date().safeParse(row.due_date).success) throw new Error("Invalid invoice data");
    seen.add(row.id);
    if (typeof row.balance_paise !== "number" && typeof row.balance_paise !== "string") throw new Error("Invalid invoice balance");
    if (typeof row.balance_paise === "number" && (!Number.isSafeInteger(row.balance_paise) || row.balance_paise < 0)) throw new Error("Invalid invoice balance");
    if (typeof row.balance_paise === "string" && !/^\d+$/.test(row.balance_paise)) throw new Error("Invalid invoice balance");
    const amount = BigInt(row.balance_paise);
    if (amount < 0n || amount > 9007199254740991n) throw new Error("Invalid invoice balance");
    if (amount === 0n) continue;
    const days = (todayMs - Date.parse(`${row.due_date}T00:00:00Z`)) / 86400000;
    const index = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    buckets[index].count++; buckets[index].balance += amount;
    outstandingCount++; outstanding += amount;
    if (days > 0) { overdueCount++; overdue += amount; }
  }
  return { invoiceCount: rows.length, outstandingCount, overdueCount, outstanding, overdue, buckets };
}

/** Business-facing date uses India time, independent of server timezone. */
export function indiaDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
