import { beforeEach, describe, expect, it, vi } from "vitest";
import { canManageCustomers, customerSchema, isStandardGstin } from "@/lib/validation/customer";

const { getWorkspace, revalidatePath, from, insert, update, eq, select, single, maybeSingle, rpc } = vi.hoisted(() => ({
  getWorkspace: vi.fn(), revalidatePath: vi.fn(), from: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/guard", () => ({ getWorkspace }));
vi.mock("next/cache", () => ({ revalidatePath }));
import vectors from "./customer-gstin-vectors.json";
import { checkCustomerDuplicates, saveCustomer } from "@/app/(workspace)/workspace/customers/actions";

const businessId = "20000000-0000-4000-8000-000000000001";
const customerId = "50000000-0000-4000-8000-000000000001";
const input = { name: " Buyer ", contactPerson: " Sam ", email: "buyer@example.invalid", phone: "1234567890", gstin: "27abcde1234f1z0", stateCode: "27" };
const form = (values: Record<string, string> = {}) => { const f = new FormData(); for (const [k, v] of Object.entries({ ...input, editVersion: "1", expectedBusinessId: businessId, requestId: "60000000-0000-4000-8000-000000000001", ...values })) f.set(k, v); return f; };

describe("customer validation", () => {
  it("agrees with SQL on the shared raw standard GSTIN vectors", () => { for (const {value,valid} of vectors) expect(isStandardGstin(value),value).toBe(valid); });
  it("normalizes values and matches GSTIN with state", () => expect(customerSchema.parse(input)).toMatchObject({ name: "Buyer", contactPerson: "Sam", gstin: "27ABCDE1234F1Z0" }));
  it("rejects invalid name, email, state and mismatched GSTIN", () => {
    for (const change of [{ name: " " }, { email: "not-an-email" }, { gstin: "BAD" }, { gstin: "27XXXXXXXXXXXXX" }, { gstin: "27ABCDE1234F1Z5" }, { phone: "abc" }, { phone: "123" }, { stateCode: "2" }, { stateCode: "29" }]) expect(customerSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it("validates standard state prefix and synthetic check digits without asserting registration", () => {
    for (const gstin of ["01ABCDE1234F1ZE","27ABCDE1234F1Z0","29ABCDE1234F1ZW","38ABCDE1234F1ZX"]) expect(customerSchema.safeParse({...input,gstin,stateCode:gstin.slice(0,2)}).success).toBe(true);
    for (const change of [{gstin:"00ABCDE1234F1ZG",stateCode:"00"},{gstin:"27ABCDE1234F1Z5"},{gstin:"",stateCode:"39"}]) expect(customerSchema.safeParse({...input,...change}).success).toBe(false);
  });
  it("permits blank optional fields and limits write roles", () => {
    expect(customerSchema.safeParse({ name: "A", contactPerson: "", email: "", phone: "", gstin: "", stateCode: "" }).success).toBe(true);
    for (const role of ["owner", "admin", "manager"]) expect(canManageCustomers(role)).toBe(true);
    for (const role of ["viewer", "accountant", "suspended", ""]) expect(canManageCustomers(role)).toBe(false);
  });
});

describe("customer server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspace.mockResolvedValue({ business: { id: businessId }, membership: { role: "manager" }, supabase: { from, rpc } });
    from.mockReturnValue({ insert, update }); insert.mockReturnValue({ select }); update.mockReturnValue({ eq });
    eq.mockReturnValue({ eq, is: eq, select }); select.mockReturnValue({ single, maybeSingle });
    single.mockResolvedValue({ data: { id: customerId }, error: null }); rpc.mockResolvedValue({data:{customer_id:customerId,replayed:false},error:null}); maybeSingle.mockResolvedValue({ data: { id: customerId }, error: null });
  });
  it("duplicate checks use verified tenant and manager role and return presence only", async () => {
    rpc.mockResolvedValueOnce({data:{possible_match:true},error:null});
    expect(await checkCustomerDuplicates({}, form())).toEqual({checked:true,possibleMatch:true});
    expect(rpc).toHaveBeenCalledWith("customer_duplicate_advisory",expect.objectContaining({p_business_id:businessId}));
    getWorkspace.mockResolvedValueOnce({business:{id:businessId},membership:{role:"viewer"},supabase:{rpc}});
    expect((await checkCustomerDuplicates({},form())).error).toBeTruthy();expect(rpc).toHaveBeenCalledTimes(1);
    expect((await checkCustomerDuplicates({},form({email:"",phone:"",gstin:""}))).error).toBeTruthy();
  });
  it("creates only in the verified workspace and normalizes values", async () => {
    expect(await saveCustomer({}, form({ businessId: "attacker-supplied" }))).toEqual({ success: true, replayed: false });
    expect(rpc).toHaveBeenCalledWith("create_customer_once", expect.objectContaining({ p_name: "Buyer", p_business_id: businessId, p_gstin: "27ABCDE1234F1Z0" }));
    expect(revalidatePath).toHaveBeenCalledWith("/workspace/customers");
  });
  it("returns replay without a new insert and rejects invalid keys", async () => {
    rpc.mockResolvedValueOnce({data:{customer_id:customerId,replayed:true},error:null});
    expect(await saveCustomer({}, form())).toEqual({success:true,replayed:true});
    expect(insert).not.toHaveBeenCalled();
    expect((await saveCustomer({}, form({requestId:"invalid"}))).error).toMatch(/invalid customer request/i);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("sends a versioned update to the verified workspace", async () => {
    expect(await saveCustomer({}, form({ id: customerId }))).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("update_customer_if_version", expect.objectContaining({p_business_id:businessId,p_customer_id:customerId,p_expected_version:1,p_name:"Buyer"}));
    expect(from).not.toHaveBeenCalled();
  });
  it("fails closed if workspace changed, role is forbidden, id invalid or input invalid", async () => {
    expect((await saveCustomer({}, form({ expectedBusinessId: "another-workspace" }))).error).toMatch(/workspace changed/i);
    getWorkspace.mockResolvedValueOnce({ business: { id: businessId }, membership: { role: "viewer" }, supabase: { from, rpc } });
    expect((await saveCustomer({}, form())).error).toMatch(/permission/i);
    expect((await saveCustomer({}, form({ id: "bad" }))).error).toMatch(/invalid customer/i);
    expect((await saveCustomer({}, form({ name: " " }))).error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });
  it("rejects malformed versions and stale edits without leaking details", async () => {
    expect((await saveCustomer({}, form({ id: customerId, editVersion: "bad" }))).error).toMatch(/invalid edit request/i);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({data:null,error:{code:"40001",message:"sensitive details"}});
    const stale=await saveCustomer({},form({id:customerId}));
    expect(stale.error).toMatch(/changed.*reload/i);expect(stale.error).not.toContain("sensitive details");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("reports identifier conflict without exposing provider messages", async () => {
    rpc.mockResolvedValueOnce({data:null,error:{code:"23505",message:"sensitive details"}});
    const r=await saveCustomer({},form());expect(r.error).toMatch(/conflict/i);expect(r.error).not.toContain("sensitive details");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("rejects a provider error", async () => {
    rpc.mockResolvedValueOnce({data:null,error:{message:"sensitive details"}});
    const r=await saveCustomer({},form());expect(r.error).not.toContain("sensitive details");expect(r.success).not.toBe(true);
  });

});
