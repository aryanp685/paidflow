import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const {getWorkspace,notFound}=vi.hoisted(()=>({getWorkspace:vi.fn(),notFound:vi.fn(()=>{throw new Error("NOT_FOUND");})}));
vi.mock("@/lib/supabase/guard",()=>({getWorkspace}));vi.mock("next/navigation",()=>({notFound}));
import PaymentsPage from "@/app/(workspace)/workspace/payments/page";
import PaymentDetailPage from "@/app/(workspace)/workspace/payments/[id]/page";
import RecordPaymentPage from "@/app/(workspace)/workspace/invoices/[id]/record-payment/page";
const id="50000000-0000-4000-8000-000000000001",invoice="40000000-0000-4000-8000-000000000001";
const payment={id,invoice_id:invoice,payment_date:"2026-05-01",amount_paise:101,payment_mode:"upi",status:"voided",reference_id:null,notes:null,voided_at:"2026-05-02",voided_reason:"Correction"};
function mockDb(results:Record<string,{data:unknown;error:object|null;count?:number|null}>, role="owner"){
 const filters:Record<string,[string,unknown][]>= {},orders:Record<string,string[]>= {},ranges:Record<string,number[]>= {};
 const from=vi.fn((table:string)=>{filters[table]=[];orders[table]=[];const q={select:vi.fn(()=>q),eq:vi.fn((k:string,v:unknown)=>{filters[table].push([k,v]);return q;}),order:vi.fn((k:string)=>{orders[table].push(k);return q;}),range:vi.fn((a:number,b:number)=>{ranges[table]=[a,b];return q;}),maybeSingle:vi.fn(async()=>results[table]),then:(resolve:(v:unknown)=>void)=>Promise.resolve(results[table]).then(resolve)};return q;});getWorkspace.mockResolvedValue({business:{id:"tenant-a"},membership:{role},supabase:{from}});return {filters,orders,ranges};
}
beforeEach(()=>{vi.clearAllMocks();cleanup();});
describe("payment reads",()=>{
 it("scopes and consistently orders paginated payment history",async()=>{const {filters,orders,ranges}=mockDb({payments:{data:Array.from({length:50},(_,i)=>({...payment,id:`p${i}`})),count:101,error:null}});render(await PaymentsPage({searchParams:Promise.resolve({page:"2"})}));expect(filters.payments).toContainEqual(["business_id","tenant-a"]);expect(orders.payments).toEqual(["payment_date","id"]);expect(ranges.payments).toEqual([50,99]);expect(screen.getAllByText("voided")).toHaveLength(50);expect(screen.getByRole("link",{name:/Next/})).toBeTruthy();});
 it("never treats provider errors or missing data as empty history",async()=>{for(const result of [{data:null,count:null,error:{message:"offline"}},{data:null,count:0,error:null}]) {mockDb({payments:result});await expect(PaymentsPage({searchParams:Promise.resolve({})})).rejects.toThrow("Unable to load payments");}});
 it("scopes payment and invoice detail and displays historical void reason",async()=>{const {filters}=mockDb({payments:{data:payment,error:null},invoices:{data:{id:invoice,invoice_number:"INV-1"},error:null}});render(await PaymentDetailPage({params:Promise.resolve({id})}));expect(filters.payments).toContainEqual(["business_id","tenant-a"]);expect(filters.invoices).toContainEqual(["business_id","tenant-a"]);expect(screen.getByText("Correction")).toBeTruthy();expect(screen.queryByRole("checkbox")).toBeNull();});
 it("does not reveal another tenant's payment or hide query failures",async()=>{mockDb({payments:{data:null,error:null}});await expect(PaymentDetailPage({params:Promise.resolve({id})})).rejects.toThrow("NOT_FOUND");mockDb({payments:{data:null,error:{message:"offline"}}});await expect(PaymentDetailPage({params:Promise.resolve({id})})).rejects.toThrow("Unable to load payment");});
 it("limits recording to authorized roles and issued tenant invoices",async()=>{mockDb({},"viewer");await expect(RecordPaymentPage({params:Promise.resolve({id:invoice})})).rejects.toThrow("NOT_FOUND");const {filters}=mockDb({invoices:{data:{id:invoice,invoice_number:"INV-1",balance_paise:101,lifecycle_status:"draft"},error:null}});await expect(RecordPaymentPage({params:Promise.resolve({id:invoice})})).rejects.toThrow("NOT_FOUND");expect(filters.invoices).toContainEqual(["business_id","tenant-a"]);});
});
