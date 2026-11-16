import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReminderComposer } from "@/components/reminders/reminder-composer";
import { reminderTemplates } from "@/lib/reminders/templates";
afterEach(cleanup);
const details = { customerName:"ग्राहक & Co", invoiceNumber:"INV/1", dueDate:"2026-05-01", balance:"₹1,234.56", businessName:"विक्रेता" };
describe("multilingual manual reminders",()=>{
  it("includes identical invoice details in every editable starting template",()=>{const templates=reminderTemplates(details);for(const value of Object.values(templates)) for(const detail of Object.values(details)) expect(value).toContain(detail);expect(templates.hi).toContain("नमस्ते");expect(templates.mr).toContain("नमस्कार");expect(templates.en).toContain("Hello");});
  it("keeps edits separately across language changes and marks text language",()=>{
    render(<ReminderComposer templates={reminderTemplates(details)} />);
    const language=screen.getByLabelText("Draft language"), message=screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(message.lang).toBe("en");fireEvent.change(message,{target:{value:"Custom English"}});
    fireEvent.change(language,{target:{value:"hi"}});expect(message.lang).toBe("hi");expect(message.value).toContain("इनवॉइस");fireEvent.change(message,{target:{value:"मेरी हिंदी"}});
    fireEvent.change(language,{target:{value:"mr"}});expect(message.lang).toBe("mr");expect(message.value).toContain("इनव्हॉइस");fireEvent.change(message,{target:{value:"माझा मजकूर"}});
    fireEvent.change(language,{target:{value:"en"}});expect(message.value).toBe("Custom English");fireEvent.change(language,{target:{value:"hi"}});expect(message.value).toBe("मेरी हिंदी");fireEvent.change(language,{target:{value:"mr"}});expect(message.value).toBe("माझा मजकूर");
    expect(screen.getByText(/Review the wording and details/)).toBeTruthy();
  });
  it("encodes the selected edited language for manual WhatsApp and email handoff",()=>{
    render(<ReminderComposer templates={reminderTemplates(details)} />);
    fireEvent.change(screen.getByLabelText("Draft language"),{target:{value:"hi"}});
    fireEvent.change(screen.getByLabelText("Message"),{target:{value:"नमस्ते & भुगतान?"}});
    fireEvent.change(screen.getByLabelText(/WhatsApp number/),{target:{value:"+919876543210"}});
    fireEvent.change(screen.getByLabelText(/Email address/),{target:{value:"buyer@example.com"}});
    expect(screen.getByRole("link",{name:/Open WhatsApp/}).getAttribute("href")).toBe(`https://wa.me/919876543210?text=${encodeURIComponent("नमस्ते & भुगतान?")}`);
    expect(screen.getByRole("link",{name:/Open email draft/}).getAttribute("href")).toContain(encodeURIComponent("इनवॉइस भुगतान का अनुस्मारक"));
    expect(screen.getByText(/You must review and send there/)).toBeTruthy();
  });
});
