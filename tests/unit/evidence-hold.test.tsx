import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EvidencePage from "@/app/(workspace)/workspace/evidence/page";
afterEach(cleanup);
describe("evidence hold page", () => {
  it("explains the hold without implying historical documents are scanned or absent", () => {
    render(<EvidencePage />);
    expect(screen.getByRole("heading", { name: "Evidence vault" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Proof attachments are unavailable" })).toBeTruthy();
    expect(screen.getByText(/cannot upload, attach, preview or download/i)).toBeTruthy();
    expect(screen.getByText(/does not show existing documents or their scan status/i)).toBeTruthy();
    expect(screen.getByText(/not independently verified/i)).toBeTruthy();
  });
  it("exposes no file input, form, action button or file link", () => {
    const { container } = render(<EvidencePage />);
    expect(container.querySelector('input, form, button, iframe, object, embed, img, video, audio')).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/workspace/payments");
  });
});
