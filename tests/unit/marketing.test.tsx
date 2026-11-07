import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProductPreview } from "@/components/marketing/product-preview";
import { faqs, navigation } from "@/lib/constants";
import { cn } from "@/lib/utils";
describe("marketing foundation", () => {
  it("merges Tailwind classes", () => expect(cn("p-2", "p-4")).toBe("p-4"));
  it("uses internal section destinations", () => expect(navigation.every((item) => item.href.startsWith("#"))).toBe(true));
  it("is explicit that UPI is not automatically verified", () => expect(faqs.find(([question]) => question.includes("verify UPI"))?.[1]).toMatch(/not automatically verified/i));
  it("updates the illustrative preview period", () => { render(<ProductPreview />); fireEvent.click(screen.getByRole("button", { name: "7 days" })); expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true"); expect(screen.getByLabelText(/illustrative collection total for 7 days/i)).toBeInTheDocument(); });
});
