import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
vi.mock("@/app/(workspace)/workspace/invoices/actions", () => ({ createInvoiceDraft: vi.fn() }));
import { DraftForm } from "@/components/invoices/draft-form";
const business = "20000000-0000-4000-8000-000000000001";
const props = { businessId: business, customers: [{id:"30000000-0000-4000-8000-000000000001",name:"Buyer"}], today:"2026-05-01" };
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); sessionStorage.clear(); });
describe("non-GST draft form", () => {
  it("retains a request key on reload and supports adding and removing lines", () => {
    const view=render(<DraftForm {...props} />);
    fireEvent.click(screen.getByRole("button", {name:/Start draft/}));
    const stored=sessionStorage.getItem(`paidflow.invoice-draft-request.${business}`);
    expect(stored).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.click(screen.getByRole("button",{name:/Add line/})); expect(screen.getAllByLabelText(/Description/)).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button",{name:/Remove line/})[0]); expect(screen.getAllByLabelText(/Description/)).toHaveLength(1);
    view.unmount(); render(<DraftForm {...props} />); fireEvent.click(screen.getByRole("button", {name:/Start draft/}));
    expect(sessionStorage.getItem(`paidflow.invoice-draft-request.${business}`)).toBe(stored);
    expect((document.querySelector('input[name="requestId"]') as HTMLInputElement).value).toBe(stored);
  });
});
