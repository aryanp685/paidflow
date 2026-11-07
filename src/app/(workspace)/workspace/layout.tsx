export const dynamic = "force-dynamic";
import { getWorkspace } from "@/lib/supabase/guard"; import { WorkspaceShell } from "@/components/workspace/shell";
export default async function Layout({children}:{children:React.ReactNode}) { const {user,business,businesses,membership}=await getWorkspace(); return <WorkspaceShell business={business} businesses={businesses} email={user.email ?? "Account"} role={membership.role}>{children}</WorkspaceShell>; }
