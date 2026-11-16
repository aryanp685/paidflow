import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  config: vi.fn(), origin: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), resend: vi.fn(), signOut: vi.fn(),
  replace: vi.fn(), refresh: vi.fn(), client: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseConfig: mocks.config, getSiteOrigin: mocks.origin }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: mocks.client }));
import { AuthForm } from "@/components/auth/auth-form";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({ url: "https://auth.example", key: "synthetic" });
  mocks.origin.mockReturnValue("https://paidflow.example");
  mocks.client.mockReturnValue({ auth: { signInWithPassword: mocks.signIn, signUp: mocks.signUp, resend: mocks.resend, signOut: mocks.signOut } });
  mocks.signOut.mockResolvedValue({error: null});
});
afterEach(cleanup);
const fill = (password = "synthetic-password") => {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "person@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
};

describe("login and signup forms with a synthetic auth client", () => {
  it("disables login and signup without public configuration", () => {
    mocks.config.mockReturnValue(null);
    for (const mode of ["login", "signup"] as const) {
      const view = render(<AuthForm mode={mode} />);
      expect(screen.getByText(/Sign-in and account creation are unavailable/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: mode === "login" ? "Sign in" : "Create account" })).toBeDisabled();
      expect(mocks.client).not.toHaveBeenCalled();
      view.unmount();
    }
  });
  it("requires a configured trusted site origin for signup and verification, but not password login", () => {
    mocks.origin.mockReturnValue(null);
    for (const mode of ["signup", "verify"] as const) {
      const view = render(<AuthForm mode={mode} />);
      expect(screen.getByText(/Verification emails cannot be requested/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: mode === "signup" ? "Create account" : "Resend verification email" })).toBeDisabled();
      view.unmount();
    }
    render(<AuthForm mode="login" />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
  it("signs in only on a consistent session result and navigates to the guarded workspace", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: "synthetic" }, session: { user: { id: "synthetic" } } }, error: null });
    render(<AuthForm mode="login" />); fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/workspace"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "person@example.invalid", password: "synthetic-password" });
  });
  it("does not navigate on invalid credentials, missing session or mismatched session user", async () => {
    for (const result of [
      { data: { user: null, session: null }, error: { message: "private provider message" } },
      { data: { user: { id: "synthetic" }, session: null }, error: null },
      { data: { user: { id: "a" }, session: { user: { id: "b" } } }, error: null },
    ]) {
      mocks.signIn.mockResolvedValueOnce(result);
      const view = render(<AuthForm mode="login" />); fill();
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to sign in");
      expect(screen.getByRole("alert")).not.toHaveTextContent("private provider message");
      expect(mocks.replace).not.toHaveBeenCalled(); view.unmount();
    }
  });
  it("submits signup to the fixed callback, clears the password and gives non-enumerating guidance", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    render(<AuthForm mode="signup" />); fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByText(/If this email can be registered/);
    expect(mocks.signUp).toHaveBeenCalledWith({ email: "person@example.invalid", password: "synthetic-password", options: { emailRedirectTo: "https://paidflow.example/auth/callback?flow=verify" } });
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByText(/same browser where you requested it/)).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("warns instead of claiming verification if signup unexpectedly returns a session", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { id: "synthetic" }, session: { user: { id: "synthetic" } } }, error: null });
    mocks.signOut.mockResolvedValue({ error: { message: "private detail" } });
    render(<AuthForm mode="signup" />); fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email verification may not be configured correctly");
    expect(screen.getByRole("alert")).toHaveTextContent("Sign out may not have completed");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private detail");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/If this email can be registered/)).not.toBeInTheDocument();
  });
  it("warns on the login screen if sign out could not be confirmed", () => {
    render(<AuthForm mode="login" signoutFailed />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign out may not have completed");
  });
  it("rejects invalid signup inputs locally without calling the provider", async () => {
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters")).toBeInTheDocument();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("does not disclose provider signup errors or claim that a verification email was sent", async () => {
    mocks.signUp.mockResolvedValue({ error: { message: "sensitive provider detail" } });
    render(<AuthForm mode="signup" />); fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't create the account");
    expect(screen.getByRole("alert")).not.toHaveTextContent("sensitive provider detail");
    expect(screen.queryByText(/If this email can be registered/)).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("prevents edits while a sign-in request is pending and shows a generic transport error", async () => {
    let reject!: (error: Error) => void;
    mocks.signIn.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<AuthForm mode="login" />); fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByLabelText("Email address")).toBeDisabled());
    expect(screen.getByLabelText("Password")).toBeDisabled();
    reject(new Error("private transport detail"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach authentication");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private transport detail");
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeEnabled());
  });
  it("resends verification using the fixed callback without implying delivery", async () => {
    mocks.resend.mockResolvedValue({ error: null });
    render(<AuthForm mode="verify" />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "person@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    expect(await screen.findByText(/If verification is needed/)).toBeInTheDocument();
    expect(mocks.resend).toHaveBeenCalledWith({ type: "signup", email: "person@example.invalid", options: { emailRedirectTo: "https://paidflow.example/auth/callback?flow=verify" } });
  });
});
