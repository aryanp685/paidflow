import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { getWorkspace, notFound } = vi.hoisted(() => ({ getWorkspace: vi.fn(), notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));
vi.mock("@/lib/supabase/guard", () => ({ getWorkspace }));
vi.mock("next/navigation", () => ({ notFound }));
import RemindersPage from "@/app/(workspace)/workspace/reminders/page";
import ReminderPage from "@/app/(workspace)/workspace/invoices/[id]/reminder/page";
import { ReminderComposer } from "@/components/reminders/reminder-composer";
import { reminderTemplateVariants } from "@/lib/reminders/templates";
const sampleTemplates = { en:"Hello", hi:"नमस्ते", mr:"नमस्कार" };
const invoiceId = "40000000-0000-4000-8000-000000000001";
const invoice = { id:invoiceId, customer_id:"customer-a", invoice_number:"INV-1", due_date:"2026-05-01", balance_paise:10001, lifecycle_status:"issued", is_archived:false };
function mockDb(results:Record<string,{data:unknown;error:object|null;count?:number|null}>, role="manager") {
  const filters:Record<string,[string,unknown][]> = {}, orders:Record<string,string[]> = {}, ranges:Record<string,number[]> = {};
  const from = vi.fn((table:string) => { filters[table]=[];orders[table]=[];const q={select:vi.fn(()=>q),eq:vi.fn((k:string,v:unknown)=>{filters[table].push([k,v]);return q;}),gt:vi.fn((k:string,v:unknown)=>{filters[table].push([`gt:${k}`,v]);return q;}),lt:vi.fn((k:string,v:unknown)=>{filters[table].push([`lt:${k}`,v]);return q;}),gte:vi.fn((k:string,v:unknown)=>{filters[table].push([`gte:${k}`,v]);return q;}),lte:vi.fn((k:string,v:unknown)=>{filters[table].push([`lte:${k}`,v]);return q;}),order:vi.fn((k:string)=>{orders[table].push(k);return q;}),range:vi.fn((a:number,b:number)=>{ranges[table]=[a,b];return q;}),maybeSingle:vi.fn(async()=>results[table]),then:(resolve:(v:unknown)=>void)=>Promise.resolve(results[table]).then(resolve)};return q;});
  getWorkspace.mockResolvedValue({business:{id:"tenant-a",name:"Seller"},membership:{role},supabase:{from}});return {from,filters,orders,ranges};
}
beforeEach(()=>vi.clearAllMocks());afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("reminder pages",()=>{
  it("queries only active tenant issued invoices with balances, stable pagination",async()=>{const {filters,orders,ranges}=mockDb({invoices:{data:[invoice],count:51,error:null}});render(await RemindersPage({searchParams:Promise.resolve({page:"2",due:"all"})}));expect(filters.invoices).toEqual(expect.arrayContaining([["business_id","tenant-a"],["is_archived",false],["lifecycle_status","issued"],["gt:balance_paise",0]]));expect(orders.invoices).toEqual(["due_date","id"]);expect(ranges.invoices).toEqual([50,99]);expect(screen.getByText("₹100.01")).toBeTruthy();expect(screen.getByText(/No messages are sent or scheduled/)).toBeTruthy();});
  it("does not misrepresent query errors or null result as zero",async()=>{for(const value of [{data:null,error:{},count:null},{data:null,error:null,count:0}]) {mockDb({invoices:value});await expect(RemindersPage({searchParams:Promise.resolve({})})).rejects.toThrow("Unable to load invoices");}});
  it("restricts preparation to owner/admin/manager and doesn't query for viewer",async()=>{for(const role of ["viewer","accountant"]){const {from}=mockDb({},role);render(await RemindersPage({searchParams:Promise.resolve({})}));expect(screen.getByText(/Only owners, admins and managers/)).toBeTruthy();expect(from).not.toHaveBeenCalled();cleanup();await expect(ReminderPage({params:Promise.resolve({id:invoiceId})})).rejects.toThrow("NOT_FOUND");}});
  it("scopes parent and customer before constructing a draft with exact balance",async()=>{const {filters}=mockDb({invoices:{data:invoice,error:null},customers:{data:{name:"Buyer"},error:null}});render(await ReminderPage({params:Promise.resolve({id:invoiceId})}));expect(filters.invoices).toContainEqual(["business_id","tenant-a"]);expect(filters.customers).toContainEqual(["business_id","tenant-a"]);expect(filters.customers).toContainEqual(["id","customer-a"]);expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toContain("₹100.01");expect(screen.getByText(/draft is not saved/)).toBeTruthy();});
  it("provides the date-matched template using the India day at page load",async()=>{
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-04-30T18:30:00Z"));
    mockDb({invoices:{data:invoice,error:null},customers:{data:{name:"Buyer"},error:null}});
    render(await ReminderPage({params:Promise.resolve({id:invoiceId})}));
    expect(screen.getByRole("option",{name:"Due today"})).toBeInTheDocument();
    expect(screen.queryByRole("option",{name:"Overdue follow-up"})).not.toBeInTheDocument();
    expect(screen.getByText(/Date-specific drafts use the India date at page load/)).toBeInTheDocument();
    vi.useRealTimers();
  });
  it("rejects invalid, absent, paid, draft, archived and inaccessible invoices; errors are not hidden",async()=>{mockDb({});await expect(ReminderPage({params:Promise.resolve({id:"invalid"})})).rejects.toThrow("NOT_FOUND");for(const item of [null,{...invoice,balance_paise:0},{...invoice,lifecycle_status:"draft"},{...invoice,is_archived:true}]) {mockDb({invoices:{data:item,error:null}});await expect(ReminderPage({params:Promise.resolve({id:invoiceId})})).rejects.toThrow("NOT_FOUND");}mockDb({invoices:{data:null,error:{}}});await expect(ReminderPage({params:Promise.resolve({id:invoiceId})})).rejects.toThrow("Unable to load invoice");mockDb({invoices:{data:invoice,error:null},customers:{data:null,error:{}}});await expect(ReminderPage({params:Promise.resolve({id:invoiceId})})).rejects.toThrow("Unable to load customer");});
});
describe("manual reminder composer",()=>{
  it("does not open messaging links before user enters valid recipients",()=>{render(<ReminderComposer templates={{ ...sampleTemplates, en:"Hello & goodbye" }} />);expect(screen.queryByText(/Open WhatsApp/)).toBeNull();expect(screen.queryByText(/Open email draft/)).toBeNull();fireEvent.change(screen.getByLabelText(/WhatsApp number/),{target:{value:"123?text=secret"}});expect(screen.queryByText(/Open WhatsApp/)).toBeNull();fireEvent.change(screen.getByLabelText(/Email address/),{target:{value:"bad@example.com?bcc=other@example.com"}});expect(screen.queryByText(/Open email draft/)).toBeNull();});
  it("escapes edited message and recipients, hands off only after a click",()=>{render(<ReminderComposer templates={sampleTemplates} />);fireEvent.change(screen.getByLabelText("Message"),{target:{value:"Hi & #?\n₹10"}});fireEvent.change(screen.getByLabelText(/WhatsApp number/),{target:{value:"+919876543210"}});fireEvent.change(screen.getByLabelText(/Email address/),{target:{value:"buyer@example.com"}});const w=screen.getByRole("link",{name:/Open WhatsApp/});expect(w.getAttribute("href")).toBe(`https://wa.me/919876543210?text=${encodeURIComponent("Hi & #?\n₹10")}`);expect(w.getAttribute("rel")).toBe("noopener noreferrer");const mail=screen.getByRole("link",{name:/Open email draft/}).getAttribute("href")!;expect(mail).toContain("buyer%40example.com");expect(mail).toContain(encodeURIComponent("Hi & #?\n₹10"));fireEvent.change(screen.getByLabelText("Message"),{target:{value:"  "}});expect(screen.queryByRole("link",{name:/Open WhatsApp/})).toBeNull();expect((screen.getByRole("button",{name:"Copy message"}) as HTMLButtonElement).disabled).toBe(true);});
  it("copies only on click and reports success and failure without a sent claim",async()=>{const writeText=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));Object.defineProperty(navigator,"clipboard",{value:{writeText},configurable:true});render(<ReminderComposer templates={sampleTemplates} />);expect(writeText).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Copy message"}));await waitFor(()=>expect(screen.getByRole("status").textContent).toMatch(/No message was sent/));expect(writeText).toHaveBeenCalledWith("Hello");fireEvent.click(screen.getByRole("button",{name:"Copy message"}));await waitFor(()=>expect(screen.getByRole("status").textContent).toMatch(/Select and copy/));});
  it("serializes clipboard writes and ignores a late result after editing or switching language",async()=>{
    let resolveCopy!:()=>void;
    const writeText=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{resolveCopy=resolve;})).mockResolvedValue(undefined);
    Object.defineProperty(navigator,"clipboard",{value:{writeText},configurable:true});
    render(<ReminderComposer templates={sampleTemplates} />);
    fireEvent.click(screen.getByRole("button",{name:"Copy message"}));
    expect((screen.getByRole("button",{name:"Copying…"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Message"),{target:{value:"Updated"}});
    fireEvent.change(screen.getByLabelText("Draft language"),{target:{value:"hi"}});
    fireEvent.click(screen.getByRole("button",{name:"Copying…"}));
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async()=>{resolveCopy();});
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(screen.getByRole("button",{name:"Copy message"}));
    await waitFor(()=>expect(screen.getByRole("status").textContent).toMatch(/No message was sent/));
    expect(writeText).toHaveBeenLastCalledWith("नमस्ते");
  });
  it("ignores an in-flight clipboard result after switching draft type",async()=>{
    let resolveCopy!:()=>void;
    const writeText=vi.fn(()=>new Promise<void>(resolve=>{resolveCopy=resolve;}));
    Object.defineProperty(navigator,"clipboard",{value:{writeText},configurable:true});
    const variants=reminderTemplateVariants({customerName:"Buyer",invoiceNumber:"INV-1",dueDate:"2026-05-01",balance:"₹10.00",businessName:"Seller"},"2026-05-01");
    render(<ReminderComposer templates={variants.general} variants={variants}/>);
    fireEvent.click(screen.getByRole("button",{name:"Copy message"}));
    fireEvent.change(screen.getByLabelText("Draft type"),{target:{value:"today"}});
    await act(async()=>{resolveCopy();});
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("button",{name:"Copy message"})).toBeEnabled();
  });
  it("does not report a late clipboard failure for an edited draft",async()=>{
    let rejectCopy!:(error:Error)=>void;
    const writeText=vi.fn(()=>new Promise<void>((_,reject)=>{rejectCopy=reject;}));
    Object.defineProperty(navigator,"clipboard",{value:{writeText},configurable:true});
    render(<ReminderComposer templates={sampleTemplates} />);
    fireEvent.click(screen.getByRole("button",{name:"Copy message"}));
    fireEvent.change(screen.getByLabelText("Message"),{target:{value:"Changed"}});
    await act(async()=>{rejectCopy(new Error("denied"));});
    expect(screen.getByRole("status").textContent).toBe("");
    expect((screen.getByRole("button",{name:"Copy message"}) as HTMLButtonElement).disabled).toBe(false);
  });
});
