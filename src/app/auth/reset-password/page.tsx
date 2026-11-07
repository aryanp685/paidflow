import { redirect } from "next/navigation";

export default async function ResetPage() {
  redirect("/forgot-password?error=unavailable");
}
