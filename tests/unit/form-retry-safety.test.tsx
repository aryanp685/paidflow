import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const {recordPayment,createInvoiceDraft,saveCustomer}=vi.hoisted(()=>({recordPayment:vi.fn(),createInvoiceDraft:vi.fn(),saveCustomer:vi.fn()}));
vi.mock("@/app/(workspace)/workspace/payments/actions",()=>({recordPayment}));
vi.mock("@/app/(workspace)/workspace/invoices/actions",()=>({createInvoiceDraft}));
vi.mock("@/app/(workspace)/workspace/customers/actions",()=>({saveCustomer,checkCustomerDuplicates:vi.fn()}));
import { PaymentForm } from "@/components/payments/payment-form";
import { DraftForm } from "@/components/invoices/draft-form";
import { CustomerForm } from "@/components/customers/customer-form";
const business="20000000-0000-4000-8000-000000000001", invoice="40000000-0000-4000-8000-000000000001", customer="30000000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();});afterEach(()=>{cleanup();sessionStorage.clear();});
describe("form input retention after action errors",()=>{
  it("keeps payment inputs and request key when save returns an error",async()=>{
    recordPayment.mockResolvedValue({error:"Could not confirm payment"});const {container}=render(<PaymentForm businessId={business} invoiceId={invoice} today="2026-05-01" />);fireEvent.click(screen.getByRole("button",{name:/Start payment/}));
    fireEvent.change(screen.getByLabelText(/Amount received/),{target:{value:"150.12"}});fireEvent.change(screen.getByLabelText(/Payment date/),{target:{value:"2026-05-02"}});fireEvent.change(screen.getByLabelText(/Payment mode/),{target:{value:"cash"}});fireEvent.change(screen.getByLabelText("Reference"),{target:{value:"xyz"}});fireEvent.change(screen.getByLabelText("Notes"),{target:{value:"note"}});
    const key=(container.querySelector('input[name=requestId]') as HTMLInputElement).value;fireEvent.submit(container.querySelector("form")!);await screen.findByRole("alert");
    expect((screen.getByLabelText(/Amount received/) as HTMLInputElement).value).toBe("150.12");expect((screen.getByLabelText(/Payment date/) as HTMLInputElement).value).toBe("2026-05-02");expect((screen.getByLabelText(/Payment mode/) as HTMLSelectElement).value).toBe("cash");expect((screen.getByLabelText("Reference") as HTMLInputElement).value).toBe("xyz");expect((screen.getByLabelText("Notes") as HTMLInputElement).value).toBe("note");expect((container.querySelector('input[name=requestId]') as HTMLInputElement).value).toBe(key);expect(recordPayment).toHaveBeenCalledOnce();
    fireEvent.submit(container.querySelector("form")!); await waitFor(()=>expect(recordPayment).toHaveBeenCalledTimes(2)); const first=recordPayment.mock.calls[0][1] as FormData, second=recordPayment.mock.calls[1][1] as FormData; for(const field of ["requestId","invoiceId","amount","paymentDate","mode","reference","notes"]) expect(second.get(field)).toBe(first.get(field));
  });
  it("keeps invoice fields and all lines after a failed save",async()=>{
    createInvoiceDraft.mockResolvedValue({error:"Could not confirm draft"});const {container}=render(<DraftForm businessId={business} customers={[{id:customer,name:"Buyer"}]} today="2026-05-01" />);fireEvent.click(screen.getByRole("button",{name:/Start draft/}));
    fireEvent.change(screen.getByLabelText(/Customer/),{target:{value:customer}});fireEvent.change(screen.getByLabelText(/Due date/),{target:{value:"2026-05-10"}});fireEvent.change(screen.getByLabelText(/Description/),{target:{value:"Item A"}});fireEvent.change(screen.getByLabelText(/Quantity/),{target:{value:"1.250"}});fireEvent.change(screen.getByLabelText(/Unit price/),{target:{value:"100.01"}});fireEvent.click(screen.getByRole("button",{name:/Add line/}));fireEvent.change(screen.getAllByLabelText(/Description/)[1],{target:{value:"Item B"}});
    const key=(container.querySelector('input[name=requestId]') as HTMLInputElement).value;fireEvent.submit(container.querySelector("form")!);await screen.findByRole("alert");
    expect((screen.getByLabelText(/Customer/) as HTMLSelectElement).value).toBe(customer);expect((screen.getByLabelText(/Due date/) as HTMLInputElement).value).toBe("2026-05-10");expect(screen.getAllByLabelText(/Description/).map(x=>(x as HTMLInputElement).value)).toEqual(["Item A","Item B"]);expect((screen.getAllByLabelText(/Quantity/)[0] as HTMLInputElement).value).toBe("1.250");expect((screen.getAllByLabelText(/Unit price/)[0] as HTMLInputElement).value).toBe("100.01");expect((container.querySelector('input[name=requestId]') as HTMLInputElement).value).toBe(key);
  });
  it("keeps customer inputs on an uncertain result without implying it is safe to duplicate",async()=>{
    saveCustomer.mockResolvedValue({error:"Check the customer list before retrying"});const {container}=render(<CustomerForm businessId={business} />);fireEvent.click(screen.getByRole("button",{name:/Start customer/}));fireEvent.change(screen.getByLabelText(/Customer name/),{target:{value:"Buyer"}});fireEvent.change(screen.getByLabelText(/Email address/),{target:{value:"buyer@example.com"}});fireEvent.submit(container.querySelector("form")!);await waitFor(()=>expect(screen.getByRole("alert").textContent).toMatch(/Check the customer list/));expect((screen.getByLabelText(/Customer name/) as HTMLInputElement).value).toBe("Buyer");expect((screen.getByLabelText(/Email address/) as HTMLInputElement).value).toBe("buyer@example.com");
  });
});
