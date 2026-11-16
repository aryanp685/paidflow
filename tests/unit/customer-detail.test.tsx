import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const { getWorkspace, notFound } = vi.hoisted(() => ({ getWorkspace: vi.fn(), notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));
vi.mock("@/lib/supabase/guard", () => ({ getWorkspace }));
vi.mock("next/navigation", () => ({ notFound }));
import CustomersPage from "@/app/(workspace)/workspace/customers/page";
import CustomerDetailPage from "@/app/(workspace)/workspace/customers/[id]/page";
import EditPage from "@/app/(workspace)/workspace/customers/[id]/edit/page";
const id = "50000000-0000-4000-8000-000000000001", business = "20000000-0000-4000-8000-000000000001";
const customer = { id, business_id: business, name: "Synthetic buyer", contact_person: null, email: null, phone: null, gstin: null, state_code: null, is_archived: false };
type Result = { data: unknown; count?: number | null; error: object | null };
function db(results: Record<string, Result[]>, role = "viewer") {
  const filters: Record<string, [string, unknown][][]> = {};
  const from = vi.fn((table: string) => {
    const calls: [string, unknown][] = []; (filters[table] ??= []).push(calls);
    const result = results[table]?.shift(); if (!result) throw new Error(`Unexpected query ${table}`);
    const q = { select: vi.fn(() => q), eq: vi.fn((k: string, v: unknown) => { calls.push([k, v]); return q; }), ilike: vi.fn((k: string, v: unknown) => { calls.push([k, v]); return q; }), order: vi.fn(() => q), range: vi.fn(() => q), maybeSingle: vi.fn(async () => result), then: (resolve: (v: Result) => void) => Promise.resolve(result).then(resolve) }; return q;
  });
  const invoiceBalance = results.invoices?.length ? results.invoices.pop() : undefined;
  const payment = results.payments?.shift();
  const rpc = vi.fn(async () => ({ data: { balance_count: invoiceBalance?.count ?? 0, balances: invoiceBalance?.data ?? [], payment_count: payment?.count ?? 0, payments: payment?.data ?? [] }, error: null }));
  getWorkspace.mockResolvedValue({ business: { id: business }, membership: { role }, supabase: { from, rpc } });
  return { filters, from };
}
const result = (data: unknown, count?: number): Result => ({ data, count, error: null });
const setup = () => db({ customers: [result(customer)], invoices: [result([{id:"i1",invoice_number:"INV-1",invoice_date:"2026-01-01",due_date:"2026-01-02",lifecycle_status:"issued",is_archived:false,total_paise:10000,balance_paise:7500}], 1), result([{id:"i1",due_date:"2026-01-02",balance_paise:7500}], 1)], payments: [result([{id:"p1",payment_date:"2026-01-03",amount_paise:2500,payment_mode:"upi",status:"recorded"}], 1)], activity_logs: [result([{id:"a1",action:"customer.created",created_at:"2026-01-01T00:00:00Z"}], 1)] });
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
describe("customer detail", () => {
  it("uses only tenant and customer scoped records, showing real recorded balances and histories to viewers", async () => {
    const { filters } = setup(); render(await CustomerDetailPage({params:Promise.resolve({id})}));
    expect(screen.getByRole("heading",{name:"Synthetic buyer"})).toBeTruthy(); expect(screen.getAllByText("₹75.00").length).toBeGreaterThan(0); expect(screen.getByText("INV-1")).toBeTruthy(); expect(screen.getByText("₹25.00")).toBeTruthy(); expect(screen.getByText(/Customer created/)).toBeTruthy(); expect(screen.queryByRole("link",{name:"Edit customer"})).toBeNull();
    for (const table of Object.keys(filters)) for (const query of filters[table]) expect(query).toContainEqual(["business_id",business]);
    for (const query of filters.invoices) expect(query).toContainEqual(["customer_id",id]);
    expect(filters.activity_logs[0]).toContainEqual(["entity_id",id]);
  });
  it("rejects malformed or cross-tenant IDs before reading histories", async () => {
    const {from}=db({customers:[result(null)]}); await expect(CustomerDetailPage({params:Promise.resolve({id:"bad"})})).rejects.toThrow("NOT_FOUND"); expect(from).not.toHaveBeenCalled();
    await expect(CustomerDetailPage({params:Promise.resolve({id})})).rejects.toThrow("NOT_FOUND"); expect(from).toHaveBeenCalledTimes(1);
  });
  it("fails closed on incomplete ledger results", async () => {
    db({customers:[result(customer)],invoices:[result([],1),result([],0)],payments:[result([],0)],activity_logs:[result([],0)]}); await expect(CustomerDetailPage({params:Promise.resolve({id})})).rejects.toThrow("complete customer records");
  });
  it("does not present partial sums when more than 1000 issued invoices exist", async () => {
    const rows = Array.from({length:1000}, (_, i) => ({id:`invoice-${i}`,due_date:"2026-01-01",balance_paise:1}));
    db({customers:[result(customer)],invoices:[result([],0),result(rows,1001)],payments:[result([],0)],activity_logs:[result([],0)]});
    render(await CustomerDetailPage({params:Promise.resolve({id})}));
    expect(screen.getByRole("alert").textContent).toMatch(/No partial total/);
    expect(screen.queryByText(/Outstanding:/)).toBeNull();
  });
  it("stops payment pagination at 20000 and explains that additional history is unavailable", async () => {
    const payments = Array.from({length:20}, (_, i) => ({id:`p-${i}`,payment_date:"2026-05-01",amount_paise:"1",payment_mode:"cash",status:"voided"}));
    db({customers:[result(customer)],invoices:[result([],0),result([],0)],payments:[result(payments,20001)],activity_logs:[result([],0)]});
    render(await CustomerDetailPage({params:Promise.resolve({id}),searchParams:Promise.resolve({payments:"1000"})}));
    expect(screen.getByText(/Only the first 20,000 payments are accessible here/)).toBeTruthy();
    expect(screen.queryByRole("link",{name:"Next payments"})).toBeNull();
  });
  it("returns generic errors without displaying provider details", async () => {
    db({customers:[{data:null,error:{message:"private provider error"}}]});
    await expect(CustomerDetailPage({params:Promise.resolve({id})})).rejects.toThrow("Unable to load this customer");
  });
  it("blocks direct edit visits for viewers before a query", async () => { const {from}=db({},"viewer"); await expect(EditPage({params:Promise.resolve({id})})).rejects.toThrow("NOT_FOUND"); expect(from).not.toHaveBeenCalled(); });
  it("searches a literal name within the tenant and filters archived customers", async () => { const {filters}=db({customers:[result([],0)]}); render(await CustomersPage({searchParams:Promise.resolve({q:"A%_\\B",status:"archived"})})); expect(filters.customers[0]).toContainEqual(["business_id",business]); expect(filters.customers[0]).toContainEqual(["is_archived",true]); expect(filters.customers[0]).toContainEqual(["name","%A\\%\\_\\\\B%"]); expect(screen.getByText("No matching customers")).toBeTruthy(); });
});
