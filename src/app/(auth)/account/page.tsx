import Link from "next/link";
import { logout } from "@/app/(workspace)/workspace/actions";
import { requireUser } from "@/lib/supabase/guard";

export const dynamic = "force-dynamic";

// Authentication is independent of workspace provisioning. Never interpret
// this screen as proof that a business or application database is ready.
export default async function AccountPage() {
  const { user } = await requireUser();
  return <div>
    <div className="auth-kicker"><span/> ACCOUNT</div>
    <h1 className="auth-title">You’re signed in.</h1>
    <p className="auth-description">{user.email ?? "Your email-verified account"}</p>
    <div className="auth-alert" role="status">Your workspace may not be available yet. If setup is incomplete, contact the administrator. No business data is shown here.</div>
    <div className="auth-switch"><Link href="/workspace">Try opening your workspace →</Link></div>
    <form action={logout} className="auth-form"><button type="submit" className="logout-button">Sign out</button></form>
  </div>;
}
