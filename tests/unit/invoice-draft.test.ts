import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoiceDraftSchema, rupeesToPaise } from "@/lib/validation/invoice";
const { getWorkspace, revalidatePath, rpc } = vi.hoisted(() => ({ getWorkspace: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/guard", () => ({ getWorkspace }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { createInvoiceDraft } from "@/app/(workspace)/workspace/invoices/actions";
const business = "20000000-0000-4000-8000-000000000001";
const customer = "30000000-0000-4000-8000-000000000001";
const request = "60000000-0000-4000-8000-000000000001";
const invoice = "40000000-0000-4000-8000-000000000001";
const valid = { requestId: request, customerId: customer, invoiceDate: "2026-05-01", dueDate: "2026-05-15", lines: [{ description: " Work ", quantity: "1.250", unitPrice: "1.01" }] };
function form(overrides: Record<string, string> = {}) {
  const f = new FormData(); for (const [k,v] of Object.entries({ requestId:request, customerId:customer, invoiceDate:"2026-05-01", dueDate:"2026-05-15", description:" Work ", quantity:"1.250", unitPrice:"1.01", expectedBusinessId:business, ...overrides })) f.append(k,v); return f;
}
describe("non-GST invoice draft validation", () => {
  it("converts prices using exact integer paise", () => { expect(rupeesToPaise("1.01")).toBe(101n); expect(rupeesToPaise("90071992547409.91")).toBe(9007199254740991n); });
  it("rejects rounding, overflows, invalid quantities, dates and zero totals", () => {
    for (const bad of ["1.001", "-1", "90071992547409.92", "1e3"]) expect(() => rupeesToPaise(bad)).toThrow();
    for (const change of [{ quantity:"0" }, { quantity:"1.0001" }, { unitPrice:"0" }, { description:" " }]) expect(invoiceDraftSchema.safeParse({ ...valid, lines:[{ ...valid.lines[0], ...change }] }).success).toBe(false);
    expect(invoiceDraftSchema.safeParse({ ...valid, dueDate:"2026-04-30" }).success).toBe(false);
    expect(invoiceDraftSchema.safeParse({ ...valid, invoiceDate:"2026-02-30" }).success).toBe(false);
  });
});
describe("invoice draft server action", () => {
  beforeEach(() => { vi.clearAllMocks(); getWorkspace.mockResolvedValue({ business:{id:business}, membership:{role:"manager"}, supabase:{rpc} }); rpc.mockResolvedValue({ data:{invoice_id:invoice,replayed:false}, error:null }); });
  it("uses server-derived tenant and exact paise; does not issue", async () => {
    expect(await createInvoiceDraft({},form({ businessId:"attacker" }))).toEqual({ invoiceId:invoice, replayed:false });
    expect(rpc).toHaveBeenCalledWith("create_non_gst_invoice_draft", expect.objectContaining({ p_business_id:business, p_request_id:request, p_lines:[{ description:"Work", quantity:"1.250", unitPricePaise:"101" }] }));
    expect(revalidatePath).toHaveBeenCalledWith("/workspace/invoices");
  });
  it("rejects stale workspace, restricted role, invalid lines and mismatched arrays without calling the RPC", async () => {
    expect((await createInvoiceDraft({},form({expectedBusinessId:"other"}))).error).toMatch(/workspace changed/i);
    getWorkspace.mockResolvedValueOnce({business:{id:business},membership:{role:"accountant"},supabase:{rpc}});
    expect((await createInvoiceDraft({},form())).error).toMatch(/permission/i);
    expect((await createInvoiceDraft({},form({unitPrice:"-1"}))).error).toBeTruthy();
    const mismatched = form(); mismatched.append("description","extra"); expect((await createInvoiceDraft({},mismatched)).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("surfaces retry success and hides provider errors", async () => {
    rpc.mockResolvedValueOnce({data:{invoice_id:invoice,replayed:true},error:null}); expect((await createInvoiceDraft({},form())).replayed).toBe(true);
    rpc.mockResolvedValueOnce({data:null,error:{message:"sensitive provider details"}}); const result=await createInvoiceDraft({},form()); expect(result.error).toMatch(/retry/i);expect(result.error).not.toContain("sensitive provider details");
  });
});
