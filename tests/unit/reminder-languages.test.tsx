import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReminderComposer } from "@/components/reminders/reminder-composer";
import { reminderTemplates, reminderTemplateVariants } from "@/lib/reminders/templates";
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
  it("offers only a date-specific type consistent with the India-date snapshot",()=>{
    for (const [asOf,kind] of [["2026-04-30","upcoming"],["2026-05-01","today"],["2026-05-02","overdue"]] as const) {
      const variants=reminderTemplateVariants(details,asOf);
      expect(Object.keys(variants).sort()).toEqual(["general",kind].sort());
      for (const text of Object.values(variants[kind]!)) for (const value of Object.values(details)) expect(text).toContain(value);
    }
    for (const date of ["2026-02-30","not-a-date","2026-5-01"]) expect(()=>reminderTemplateVariants(details,date)).toThrow("Invalid reminder date");
  });
  it("retains edits separately by type and language and never saves or sends",()=>{
    const variants=reminderTemplateVariants(details,"2026-05-01");
    render(<ReminderComposer templates={variants.general} variants={variants}/>);
    const kind=screen.getByLabelText("Draft type"),language=screen.getByLabelText("Draft language"),message=screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(message,{target:{value:"Custom general"}});
    fireEvent.change(kind,{target:{value:"today"}});expect(message.value).toContain("due today");fireEvent.change(message,{target:{value:"Custom today"}});
    fireEvent.change(language,{target:{value:"hi"}});expect(message.value).toContain("आज");fireEvent.change(message,{target:{value:"हिंदी मसौदा"}});
    fireEvent.change(kind,{target:{value:"general"}});fireEvent.change(language,{target:{value:"en"}});expect(message.value).toBe("Custom general");
    fireEvent.change(kind,{target:{value:"today"}});expect(message.value).toBe("Custom today");fireEvent.change(language,{target:{value:"hi"}});expect(message.value).toBe("हिंदी मसौदा");
    expect(screen.getByText(/Date-specific drafts use the date at page load/)).toBeInTheDocument();
    expect(screen.queryByRole("link",{name:/Open WhatsApp/})).toBeNull();
  });

});
