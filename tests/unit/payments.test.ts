import { beforeEach, describe, expect, it, vi } from "vitest";
import { canRecordPayments, canVoidPayments, paymentSchema, voidPaymentSchema } from "@/lib/validation/payment";
const { getWorkspace, rpc, revalidatePath } = vi.hoisted(() => ({ getWorkspace:vi.fn(),rpc:vi.fn(),revalidatePath:vi.fn() }));
vi.mock("@/lib/supabase/guard",()=>({getWorkspace}));vi.mock("next/cache",()=>({revalidatePath}));
import { recordPayment, voidPayment } from "@/app/(workspace)/workspace/payments/actions";
const business="20000000-0000-4000-8000-000000000001",invoice="40000000-0000-4000-8000-000000000001",payment="50000000-0000-4000-8000-000000000001",request="60000000-0000-4000-8000-000000000001";
const valid={invoiceId:invoice,requestId:request,paymentDate:"2026-05-01",mode:"upi",amount:"1.01",reference:" Ref ",notes:" Note "};
function form(extra:Record<string,string>={}) { const f=new FormData();for(const [k,v] of Object.entries({...valid,expectedBusinessId:business,...extra}))f.append(k,v);return f; }
function voidForm(extra:Record<string,string>={}) { const f=new FormData();for(const [k,v] of Object.entries({paymentId:payment,reason:"Correction",confirm:"yes",expectedBusinessId:business,...extra}))f.append(k,v);return f; }
describe("payment validation",()=>{
  it("validates modes, dates, exact amounts, and void confirmation",()=>{
    expect(paymentSchema.safeParse(valid).success).toBe(true);
    for(const invalid of [{amount:"0"},{amount:"1.001"},{amount:"-1"},{amount:"90071992547409.92"},{paymentDate:"2026-02-30"},{mode:"card"}]) expect(paymentSchema.safeParse({...valid,...invalid}).success).toBe(false);
    expect(voidPaymentSchema.safeParse({paymentId:payment,reason:" ",confirm:"yes"}).success).toBe(false);
    expect(voidPaymentSchema.safeParse({paymentId:payment,reason:"Correction",confirm:"no"}).success).toBe(false);
  });
  it("allows the correct role sets",()=>{
    for(const role of ["owner","admin","manager","accountant"]) expect(canRecordPayments(role)).toBe(true);
    expect(canRecordPayments("viewer")).toBe(false);expect(canVoidPayments("manager")).toBe(false);expect(canVoidPayments("owner")).toBe(true);expect(canVoidPayments("admin")).toBe(true);
  });
});
describe("payment server actions",()=>{
  beforeEach(()=>{vi.clearAllMocks();getWorkspace.mockResolvedValue({business:{id:business},membership:{role:"accountant"},supabase:{rpc}});rpc.mockResolvedValue({data:{payment:{id:payment,invoice_id:invoice,status:"recorded"},replayed:false},error:null});});
  it("records exact paise with server-selected tenant and no proof, even if client submits proof",async()=>{
    const result=await recordPayment({},form({proofDocumentId:"untrusted",businessId:"wrong"}));expect(result).toMatchObject({paymentId:payment,replayed:false,status:"recorded"});
    expect(rpc).toHaveBeenCalledWith("record_payment",expect.objectContaining({p_business_id:business,p_invoice_id:invoice,p_idempotency_key:request,p_amount_paise:101,p_proof_document_id:null,p_reference_id:"Ref",p_notes:"Note"}));
  });
  it("fails closed for stale workspace, wrong role and invalid amounts",async()=>{
    expect((await recordPayment({},form({expectedBusinessId:"other"}))).error).toMatch(/workspace changed/i);
    getWorkspace.mockResolvedValueOnce({business:{id:business},membership:{role:"viewer"},supabase:{rpc}});expect((await recordPayment({},form())).error).toMatch(/permission/i);
    expect((await recordPayment({},form({amount:"0"}))).error).toBeTruthy();expect(rpc).not.toHaveBeenCalled();
  });
  it("replays historical status without claiming voided payment was recorded again",async()=>{
    rpc.mockResolvedValueOnce({data:{payment:{id:payment,invoice_id:invoice,status:"voided"},replayed:true},error:null});expect(await recordPayment({},form())).toMatchObject({paymentId:payment,replayed:true,status:"voided"});
    rpc.mockResolvedValueOnce({data:null,error:{message:"sensitive"}});expect((await recordPayment({},form())).error).not.toContain("sensitive");
  });
  it("does not claim success for malformed or mismatched payment results",async()=>{
    const other="40000000-0000-4000-8000-000000000002";
    for(const data of [
      {payment:{id:"not-a-uuid",invoice_id:invoice,status:"recorded"},replayed:false},
      {payment:{id:payment,invoice_id:other,status:"recorded"},replayed:false},
      {payment:{id:payment,invoice_id:invoice,status:"unknown"},replayed:false},
      {payment:{id:payment,invoice_id:invoice,status:"voided"},replayed:false},
      {payment:{id:payment,invoice_id:invoice,status:"recorded"},replayed:"false"},
    ]) {
      rpc.mockResolvedValueOnce({data,error:null});
      const result=await recordPayment({},form());expect(result.paymentId).toBeUndefined();expect(result.error).toMatch(/Check payment history/);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("does not claim a void for malformed, non-voided or different payment results",async()=>{
    getWorkspace.mockResolvedValue({business:{id:business},membership:{role:"owner"},supabase:{rpc}});
    for(const data of [
      {payment:{id:payment,invoice_id:invoice,status:"recorded"},replayed:false},
      {payment:{id:"50000000-0000-4000-8000-000000000002",invoice_id:invoice,status:"voided"},replayed:false},
      {payment:{id:payment,invoice_id:"not-a-uuid",status:"voided"},replayed:false},
      {payment:{id:payment,invoice_id:invoice,status:"voided"},replayed:null},
    ]) {
      rpc.mockResolvedValueOnce({data,error:null});
      const result=await voidPayment({},voidForm());expect(result.paymentId).toBeUndefined();expect(result.error).toMatch(/Check payment history/);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("requires owner/admin, reason, confirmation and verified tenant for void",async()=>{
    expect((await voidPayment({},voidForm())).error).toMatch(/owners and admins/i);expect((await voidPayment({},voidForm({confirm:"no"}))).error).toMatch(/confirm/i);
    getWorkspace.mockResolvedValueOnce({business:{id:business},membership:{role:"owner"},supabase:{rpc}});rpc.mockResolvedValueOnce({data:{payment:{id:payment,invoice_id:invoice,status:"voided"},replayed:false},error:null});
    expect(await voidPayment({},voidForm())).toMatchObject({paymentId:payment,status:"voided"});expect(rpc).toHaveBeenCalledWith("void_payment",{p_business_id:business,p_payment_id:payment,p_reason:"Correction"});
  });
});
