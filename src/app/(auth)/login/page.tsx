import { AuthForm } from "@/components/auth/auth-form";

export default async function Page({ searchParams }: { searchParams: Promise<{ signout?: string }> }) {
  const params = await searchParams;
  return <AuthForm mode="login" signoutFailed={params.signout === "failed"} />;
}
