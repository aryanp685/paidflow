import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { collectionDates, parseCollectionWindow } from "@/lib/collections/due-window";
const { getWorkspace } = vi.hoisted(() => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/supabase/guard", () => ({ getWorkspace }));
import CollectionsPage from "@/app/(workspace)/workspace/reminders/page";

function setup(result: { data: unknown; count: unknown; error: unknown }, role = "manager") {
  const calls: [string, string, unknown][] = [];
  const from = vi.fn((table: string) => {
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn((k: string, v: unknown) => { calls.push(["eq", k, v]); return q; }),
      gt: vi.fn((k: string, v: unknown) => { calls.push(["gt", k, v]); return q; }),
      lt: vi.fn((k: string, v: unknown) => { calls.push(["lt", k, v]); return q; }),
      gte: vi.fn((k: string, v: unknown) => { calls.push(["gte", k, v]); return q; }),
      lte: vi.fn((k: string, v: unknown) => { calls.push(["lte", k, v]); return q; }),
      order: vi.fn((k: string) => { calls.push(["order", k, null]); return q; }),
      range: vi.fn((a: number, b: number) => { calls.push(["range", String(a), b]); return q; }),
      then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
    };
    expect(table).toBe("invoices"); return q;
  });
  getWorkspace.mockResolvedValue({ business: { id: "tenant-a" }, membership: { role }, supabase: { from } });
  return { from, calls };
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-03-31T20:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("collections date windows", () => {
  it("uses inclusive calendar days across month, year and leap boundaries", () => {
    expect(collectionDates("2026-12-29")).toEqual({ today: "2026-12-29", until: "2027-01-04" });
    expect(collectionDates("2028-02-27").until).toBe("2028-03-04");
    expect(() => collectionDates("2026-02-30")).toThrow();
  });
  it("defaults to overdue and rejects unknown or ambiguous filters", () => {
    expect(parseCollectionWindow(undefined)).toBe("overdue");
    for (const value of ["", "unexpected", ["today", "all"]]) expect(() => parseCollectionWindow(value)).toThrow();
  });
});
describe("collections read-only queue", () => {
  it.each([
    ["overdue", [["lt", "due_date", "2026-04-01"]]],
    ["today", [["eq", "due_date", "2026-04-01"]]],
    ["next7", [["gte", "due_date", "2026-04-01"], ["lte", "due_date", "2026-04-07"]]],
    ["all", []],
  ] as const)("applies %s filter with tenant and eligibility constraints", async (due, expected) => {
    const { calls } = setup({ data: [], count: 0, error: null });
    render(await CollectionsPage({ searchParams: Promise.resolve({ due }) }));
    expect(calls).toEqual(expect.arrayContaining([["eq", "business_id", "tenant-a"], ["eq", "lifecycle_status", "issued"], ["eq", "is_archived", false], ["gt", "balance_paise", 0], ...expected]));
    expect(calls.filter(c => c[1] === "due_date" && !["order"].includes(c[0]))).toHaveLength(expected.length);
    expect(calls).toContainEqual(["range", "0", 49]);
    expect(screen.getByText(/No messages are sent or scheduled/)).toBeInTheDocument();
    expect(screen.getByText(/India date: 2026-04-01/)).toBeInTheDocument();
  });
  it("retains the selected filter when moving between complete pages", async () => {
    const invoice = { id: "invoice-a", invoice_number: "INV-1", due_date: "2026-04-01", balance_paise: 10001 };
    const { calls } = setup({ data: [invoice], count: 51, error: null });
    render(await CollectionsPage({ searchParams: Promise.resolve({ due: "today", page: "2" }) }));
    expect(calls).toContainEqual(["range", "50", 99]);
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/workspace/reminders?due=today&page=1");
    expect(screen.getByRole("link", { name: /Prepare reminder for invoice INV-1/ })).toHaveAttribute("href", "/workspace/invoices/invoice-a/reminder");
    expect(screen.getByText("₹100.01")).toBeInTheDocument();
  });
  it("rejects malformed or out-of-window rows instead of showing them as eligible", async () => {
    for (const row of [
      { id: "a", invoice_number: "INV", due_date: "2026-04-01", balance_paise: 10 },
      { id: "a", invoice_number: "INV", due_date: "not-a-date", balance_paise: 10 },
      { id: "a", invoice_number: "INV", due_date: "2026-03-31", balance_paise: 0 },
      { id: "a", invoice_number: "INV", due_date: "2026-03-31", balance_paise: true },
      { id: "a", invoice_number: "", due_date: "2026-03-31", balance_paise: 10 },
    ]) {
      setup({ data: [row], count: 1, error: null });
      await expect(CollectionsPage({ searchParams: Promise.resolve({ due: "overdue" }) })).rejects.toThrow("Invalid collection data");
    }
  });
  it("does not query for restricted roles and fails closed for partial data and provider errors", async () => {
    const restricted = setup({ data: [], count: 0, error: null }, "viewer");
    render(await CollectionsPage({ searchParams: Promise.resolve({}) }));
    expect(restricted.from).not.toHaveBeenCalled(); cleanup();
    for (const result of [{ data: [], count: 1, error: null }, { data: null, count: null, error: {} }, { data: [{id: "x"}, {id: "x"}], count: 2, error: null }]) {
      setup(result); await expect(CollectionsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Unable to load invoices");
    }
  });
});
