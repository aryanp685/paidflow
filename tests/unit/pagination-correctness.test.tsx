import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { isCompletePage } from "@/lib/data/pagination";
const {getWorkspace}=vi.hoisted(()=>({getWorkspace:vi.fn()}));
vi.mock("@/lib/supabase/guard",()=>({getWorkspace}));
import CustomersPage from "@/app/(workspace)/workspace/customers/page";
import InvoicesPage from "@/app/(workspace)/workspace/invoices/page";
import PaymentsPage from "@/app/(workspace)/workspace/payments/page";
import RemindersPage from "@/app/(workspace)/workspace/reminders/page";
const rows=(n:number)=>Array.from({length:n},(_,i)=>({id:`id-${i}`}));
afterEach(cleanup);beforeEach(()=>vi.clearAllMocks());
describe("complete page checks",()=>{
 it("allows full, last, empty and beyond-end pages",()=>{expect(isCompletePage(rows(50),100,1,50)).toBe(true);expect(isCompletePage(rows(7),57,2,50)).toBe(true);expect(isCompletePage([],0,1,50)).toBe(true);expect(isCompletePage([],3,2,50)).toBe(true);});
 it("refuses missing data/count, short results, impossible counts, duplicates and invalid pagination",()=>{const cases: Array<[{id:string}[] | null, number | null, number, number]> = [[null,0,1,50],[[],null,1,50],[rows(1),20,1,50],[rows(2),1,1,50],[[{id:"x"},{id:"x"}],2,1,50],[[], -1,1,50],[[],0,0,50],[[],0,1,0],[[],Number.MAX_SAFE_INTEGER+1,1,50]]; for(const [data,count,page,size] of cases) expect(isCompletePage(data,count,page,size)).toBe(false);});
});
function mockDb(result:{data:unknown;count:number|null;error:object|null}){const q={select:vi.fn(()=>q),eq:vi.fn(()=>q),gt:vi.fn(()=>q),order:vi.fn(()=>q),range:vi.fn(()=>Promise.resolve(result))};getWorkspace.mockResolvedValue({business:{id:"tenant-a"},membership:{role:"manager"},supabase:{from:vi.fn(()=>q)}});}
const pages=[CustomersPage,InvoicesPage,PaymentsPage,RemindersPage];
describe("all workspace lists",()=>{
 it("rejects null rows, absent count and truncated page instead of pretending the list is empty or complete",async()=>{for(const page of pages)for(const result of [{data:null,count:0,error:null},{data:[],count:null,error:null},{data:[],count:1,error:null},{data:[{id:"a"}],count:2,error:null}]){mockDb(result);await expect(page({searchParams:Promise.resolve({})})).rejects.toThrow();}});
 it("accepts a genuinely empty first page",async()=>{for(const page of pages){mockDb({data:[],count:0,error:null});render(await page({searchParams:Promise.resolve({})}));expect(screen.getByRole("heading",{level:1})).toBeTruthy();cleanup();}});
 it("prevents next-page loop at 50,000 and communicates the limit",async()=>{for(const page of [CustomersPage,InvoicesPage,PaymentsPage]) {const create=Array.from({length:50},(_,i)=>({id:`p${i}`,name:`Customer ${i}`,invoice_number:`INV-${i}`,invoice_date:"2026-01-01",due_date:"2026-02-01",lifecycle_status:"issued",total_paise:1,balance_paise:1,payment_date:"2026-02-01",amount_paise:1,payment_mode:"upi",status:"recorded"}));mockDb({data:create,count:50001,error:null});render(await page({searchParams:Promise.resolve({page:"1000"})}));expect(screen.queryByRole("link",{name:/Next/})).toBeNull();expect(screen.getByText(/first 50,000/)).toBeTruthy();cleanup();}});
});
