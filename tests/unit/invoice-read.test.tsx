import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { formatPaise } from "@/lib/financial/money";
const { getWorkspace, notFound } = vi.hoisted(() => ({ getWorkspace: vi.fn(), notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));
vi.mock("@/lib/supabase/guard", () => ({ getWorkspace }));
vi.mock("next/navigation", () => ({ notFound }));
import InvoicesPage from "@/app/(workspace)/workspace/invoices/page";
import InvoiceDetailPage from "@/app/(workspace)/workspace/invoices/[id]/page";
const invoiceId = "40000000-0000-4000-8000-000000000001";
const invoice = { id: invoiceId, business_id: "tenant-a", customer_id: "customer-a", invoice_number: "INV-01", invoice_date: "2026-05-01", due_date: "2026-05-15", lifecycle_status: "issued", supply_type: "non_gst", is_gst_invoice: false, subtotal_paise: 10001, discount_paise: 0, taxable_paise: 10001, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, shipping_paise: 0, additional_charges_paise: 0, round_off_paise: 0, total_paise: 10001, paid_paise: 100, balance_paise: 9901 };
function mockDb(data: Record<string, { data: unknown; error: object | null; count?: number | null }>) {
  const filters: Record<string, [string, unknown][]> = {};
  const from = vi.fn((table: string) => {
    filters[table] = [];
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { filters[table].push([column, value]); return query; }),
      order: vi.fn(() => query), range: vi.fn(() => query), limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => data[table]),
      then: (resolve: (value: unknown) => void) => Promise.resolve(data[table]).then(resolve),
    }; return query;
  });
  getWorkspace.mockResolvedValue({ business: { id: "tenant-a" }, membership: { role: "manager" }, supabase: { from } });
  return { from, filters };
}
beforeEach(() => { vi.clearAllMocks(); cleanup(); });
describe("integer currency formatting", () => {
  it("formats paise exactly including negative and high safe integer values", () => {
    expect(formatPaise(10001)).toBe("₹100.01"); expect(formatPaise(-9)).toBe("−₹0.09");
    expect(formatPaise("9007199254740991")).toBe("₹9,00,71,99,25,47,409.91");
  });
  it("rejects non-integers and unsafe JS numbers", () => { for (const value of [1.1, Number.MAX_SAFE_INTEGER + 1, "1.5", "abc"]) expect(() => formatPaise(value)).toThrow(); });
  it("rejects runtime values that BigInt could otherwise coerce into paise", () => {
    for (const value of [true, false, null, undefined, { valueOf: () => 1 }, 1n]) {
      expect(() => formatPaise(value as unknown as number)).toThrow("Invalid monetary value");
    }
  });
});
describe("read-only invoice pages", () => {
  it("scopes list to active workspace and does not promise create or issue", async () => {
    const { filters } = mockDb({ invoices: { data: [invoice], count: 1, error: null } });
    render(await InvoicesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("INV-01")).toBeTruthy(); expect(screen.getByText(/Drafts only/)).toBeTruthy();
    expect(filters.invoices).toContainEqual(["business_id", "tenant-a"]); expect(filters.invoices).toContainEqual(["is_archived", false]);
  });
  it("fails rather than displaying invented data when list query fails", async () => {
    mockDb({ invoices: { data: null, count: null, error: { message: "offline" } } });
    await expect(InvoicesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Unable to load invoices");
  });
  it("scopes detail, customer and line items to the active workspace", async () => {
    const { filters } = mockDb({ invoices: { data: invoice, error: null }, customers: { data: { name: "Buyer" }, error: null }, invoice_items: { data: [], count: 0, error: null } });
    render(await InvoiceDetailPage({ params: Promise.resolve({ id: invoiceId }) }));
    expect(screen.getByText("INV-01")).toBeTruthy();
    for (const table of ["invoices", "customers", "invoice_items"]) expect(filters[table]).toContainEqual(["business_id", "tenant-a"]);
    expect(filters.invoice_items).toContainEqual(["invoice_id", invoiceId]);
  });
  it("does not display incomplete item lists or another tenant's invoice", async () => {
    mockDb({ invoices: { data: invoice, error: null }, customers: { data: { name: "Buyer" }, error: null }, invoice_items: { data: [], count: 1, error: null } });
    await expect(InvoiceDetailPage({ params: Promise.resolve({ id: invoiceId }) })).rejects.toThrow("complete invoice item list");
    mockDb({ invoices: { data: null, error: null } });
    await expect(InvoiceDetailPage({ params: Promise.resolve({ id: invoiceId }) })).rejects.toThrow("NOT_FOUND");
  });
});
