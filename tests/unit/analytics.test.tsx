import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { indiaDate, invoiceAnalytics } from "@/lib/financial/analytics";
const { getWorkspace } = vi.hoisted(() => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/supabase/guard", () => ({ getWorkspace }));
import AnalyticsPage from "@/app/(workspace)/workspace/analytics/page";
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("invoice analytics arithmetic",()=>{
  it("uses inclusive aging boundaries, ignores zero balance, and sums integer paise exactly",()=>{
    const rows = [
      {id:"a",due_date:"2026-05-01",balance_paise:100}, {id:"b",due_date:"2026-05-02",balance_paise:200},
      {id:"c",due_date:"2026-04-30",balance_paise:300}, {id:"d",due_date:"2026-04-01",balance_paise:400},
      {id:"e",due_date:"2026-03-31",balance_paise:500}, {id:"f",due_date:"2026-03-02",balance_paise:600},
      {id:"g",due_date:"2026-03-01",balance_paise:700}, {id:"h",due_date:"2026-01-31",balance_paise:800},
      {id:"i",due_date:"2026-01-30",balance_paise:900}, {id:"j",due_date:"2025-01-01",balance_paise:0},
    ];
    const result=invoiceAnalytics(rows,"2026-05-01");
    expect(result).toMatchObject({invoiceCount:10,outstandingCount:9,overdueCount:7,outstanding:4500n,overdue:4200n});
    expect(result.buckets.map(x=>[x.count,x.balance])).toEqual([[2,300n],[2,700n],[2,1100n],[2,1500n],[1,900n]]);
  });
  it("preserves totals exceeding safe JS integers",()=>{const r=invoiceAnalytics([{id:"1",due_date:"2026-01-01",balance_paise:9007199254740991},{id:"2",due_date:"2026-01-01",balance_paise:"9007199254740991"}],"2026-02-01");expect(r.outstanding).toBe(18014398509481982n);});
  it("rejects invalid dates, negative or unsafe balances and duplicate rows",()=>{const row={id:"1",due_date:"2026-01-01",balance_paise:1};for(const r of [[{...row,due_date:"2026-02-30"}],[{...row,balance_paise:-1}],[{...row,balance_paise:Number.MAX_SAFE_INTEGER+1}],[{...row,balance_paise:"1.5"}],[row,row]]) expect(()=>invoiceAnalytics(r,"2026-05-01")).toThrow();expect(()=>invoiceAnalytics([],"2026-02-30")).toThrow();});
  it("rejects unexpected runtime types rather than coercing them into balances or identifiers",()=>{
    const row={id:"1",due_date:"2026-01-01",balance_paise:1};
    for (const value of [true, false, null, undefined, { valueOf: () => 1 }, 1n]) {
      expect(()=>invoiceAnalytics([{...row,balance_paise:value} as unknown as typeof row],"2026-05-01")).toThrow();
    }
    for (const value of [null, 1, {}, true]) {
      expect(()=>invoiceAnalytics([{...row,id:value} as unknown as typeof row],"2026-05-01")).toThrow();
    }
    expect(()=>invoiceAnalytics([null as unknown as typeof row],"2026-05-01")).toThrow();
  });
  it("uses India calendar day regardless of UTC midnight",()=>{expect(indiaDate(new Date("2026-04-30T18:29:00Z"))).toBe("2026-04-30");expect(indiaDate(new Date("2026-04-30T18:30:00Z"))).toBe("2026-05-01");});
});
function mockDb(result:{ data: unknown; count:number|null; error:object|null }) {
  const filters:[string,unknown][]=[];let ordered="";let range:number[]=[];
  const query={select:vi.fn(()=>query),eq:vi.fn((k:string,v:unknown)=>{filters.push([k,v]);return query;}),order:vi.fn((k:string)=>{ordered=k;return query;}),range:vi.fn((a:number,b:number)=>{range=[a,b];return Promise.resolve(result);})};
  const from=vi.fn(()=>query);getWorkspace.mockResolvedValue({business:{id:"tenant-a"},membership:{role:"viewer"},supabase:{from}});
  return {filters,get ordered(){return ordered;},get range(){return range;},from};
}
beforeEach(()=>vi.clearAllMocks());
describe("analytics page",()=>{
  it("scopes query and displays actual issued balances and due-date buckets",async()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-04-30T18:30:00Z"));const db=mockDb({data:[{id:"1",due_date:"2026-04-30",balance_paise:10001},{id:"2",due_date:"2026-05-01",balance_paise:500}],count:2,error:null});render(await AnalyticsPage());expect(db.from).toHaveBeenCalledWith("invoices");expect(db.filters).toEqual(expect.arrayContaining([["business_id","tenant-a"],["is_archived",false],["lifecycle_status","issued"]]));expect(db.ordered).toBe("id");expect(db.range).toEqual([0,999]);expect(screen.getByText("₹105.01")).toBeTruthy();expect(screen.getAllByText("₹100.01")).toHaveLength(2);expect(screen.getByText(/due before 2026-05-01/)).toBeTruthy();expect(screen.getByText(/not independently verified/)).toBeTruthy();});
  it("renders genuine empty state as zeros",async()=>{mockDb({data:[],count:0,error:null});render(await AnalyticsPage());expect(screen.getByText("Issued invoices")).toBeTruthy();expect(screen.getAllByText("₹0.00").length).toBeGreaterThan(0);});
  it("fails closed on provider error, missing count, incomplete data and duplicate IDs",async()=>{for(const res of [{data:null,count:null,error:{}},{data:[],count:null,error:null},{data:[],count:1,error:null},{data:[{id:"a",due_date:"2026-01-01",balance_paise:1},{id:"a",due_date:"2026-01-01",balance_paise:1}],count:2,error:null}]){mockDb(res);await expect(AnalyticsPage()).rejects.toThrow();}});
  it("does not render fabricated totals for malformed provider balances",async()=>{
    for (const balance of [true, false, { valueOf: () => 1 }]) {
      mockDb({data:[{id:"a",due_date:"2026-01-01",balance_paise:balance}],count:1,error:null});
      await expect(AnalyticsPage()).rejects.toThrow("Invalid invoice balance");
    }
  });
  it("shows no partial totals when more than 1000 invoices",async()=>{mockDb({data:[],count:1001,error:null});render(await AnalyticsPage());expect(screen.getByRole("alert").textContent).toMatch(/No partial totals/);expect(screen.queryByText("Outstanding balance")).toBeNull();});
});
