import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(), signOut: vi.fn(), createClient: vi.fn(), revalidate: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/guard", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseConfig: mocks.config }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { logout } from "@/app/(workspace)/workspace/actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT ${url}`); });
  mocks.config.mockReturnValue({ url: "https://auth.example", key: "synthetic" });
  mocks.createClient.mockResolvedValue({ auth: { signOut: mocks.signOut } });
});
describe("logout", () => {
  it("requests local signout, revalidates and redirects only after a successful response", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    await expect(logout()).rejects.toThrow("REDIRECT /login");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
  it("reports uncertain signout on returned errors, exceptions and missing configuration", async () => {
    for (const failure of ["provider", "transport", "config"] as const) {
      vi.clearAllMocks();
      mocks.config.mockReturnValue(failure === "config" ? null : {});
      if (failure === "provider") mocks.signOut.mockResolvedValueOnce({ error: { message: "private" } });
      if (failure === "transport") mocks.signOut.mockRejectedValueOnce(new Error("private"));
      await expect(logout()).rejects.toThrow("REDIRECT /login?signout=failed");
      expect(mocks.revalidate).not.toHaveBeenCalled();
      expect(mocks.redirect).toHaveBeenCalledWith("/login?signout=failed");
      if (failure === "config") expect(mocks.createClient).not.toHaveBeenCalled();
    }
  });
});
