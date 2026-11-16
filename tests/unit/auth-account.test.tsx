import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), logout: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`REDIRECT ${path}`); }),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/guard", () => ({
  requireUser: mocks.requireUser,
  workspaceSchemaMissing: (error: {code?: string} | null) => error?.code === "PGRST205" || error?.code === "42P01",
}));
vi.mock("@/app/(workspace)/workspace/actions", () => ({ logout: mocks.logout }));
vi.mock("@/components/onboarding/wizard", () => ({ OnboardingWizard: () => <div>Onboarding wizard</div> }));
import AccountPage from "@/app/(auth)/account/page";
import OnboardingPage from "@/app/onboarding/page";

beforeEach(() => { cleanup(); vi.clearAllMocks(); });
describe("signed-in account fallback", () => {
  it("requires a verified user and explains that workspace setup may be unavailable", async () => {
    mocks.requireUser.mockResolvedValue({ user: { email: "person@example.invalid" } });
    render(await AccountPage());
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(screen.getByText("You’re signed in.")).toBeInTheDocument();
    expect(screen.getByText(/Your workspace may not be available yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", {name: /Try opening your workspace/})).toHaveAttribute("href", "/workspace");
    expect(screen.getByRole("button", {name: "Sign out"})).toBeInTheDocument();
  });
  it("propagates authentication failures instead of rendering account data", async () => {
    mocks.requireUser.mockRejectedValue(new Error("REDIRECT /login"));
    await expect(AccountPage()).rejects.toThrow("REDIRECT /login");
  });
  it("sends missing workspace schema to the account notice but does not hide other database errors", async () => {
    for (const code of ["PGRST205", "42P01", "42501"]) {
      const limit = vi.fn().mockResolvedValue({ data: null, error: {code} });
      const eq = vi.fn().mockReturnThis();
      const select = vi.fn().mockReturnValue({eq, limit});
      eq.mockReturnValue({eq, limit});
      mocks.requireUser.mockResolvedValue({user: {id: "synthetic"}, supabase: {from: () => ({select})}});
      await expect(OnboardingPage()).rejects.toThrow(code === "42501" ? "Unable to verify workspace access." : "REDIRECT /account?workspace=unavailable");
    }
  });
});
