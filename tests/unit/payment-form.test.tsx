import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/app/(workspace)/workspace/payments/actions",()=>({recordPayment:vi.fn(),voidPayment:vi.fn()}));
import { PaymentForm } from "@/components/payments/payment-form";
import { VoidForm } from "@/components/payments/void-form";
const business="20000000-0000-4000-8000-000000000001",invoice="40000000-0000-4000-8000-000000000001",payment="50000000-0000-4000-8000-000000000001";
beforeEach(()=>sessionStorage.clear());afterEach(()=>{cleanup();sessionStorage.clear();});
describe("payment UI",()=>{
  it("persists an invoice-specific request key in the same tab across reloads",()=>{
    const key=`paidflow.payment-request.${business}.${invoice}`;const first=render(<PaymentForm businessId={business} invoiceId={invoice} today="2026-05-01" />);
    fireEvent.click(screen.getByRole("button",{name:/Start payment/}));const stored=sessionStorage.getItem(key);expect(stored).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText(/Proof attachments are unavailable/)).toBeTruthy();first.unmount();render(<PaymentForm businessId={business} invoiceId={invoice} today="2026-05-01" />);fireEvent.click(screen.getByRole("button",{name:/Start payment/}));expect((document.querySelector('input[name="requestId"]') as HTMLInputElement).value).toBe(stored);
  });
  it("requires explicit user confirmation and a reason for void",()=>{render(<VoidForm businessId={business} paymentId={payment} />);expect((screen.getByLabelText(/Reason/) as HTMLInputElement).required).toBe(true);expect((screen.getByRole("checkbox") as HTMLInputElement).required).toBe(true);expect(screen.getByText(/cannot be undone/)).toBeTruthy();});
});
