"use server";
import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/supabase/guard";
import { canChangeMember, memberChangeSchema } from "@/lib/validation/team";
export type TeamActionState = { error?: string; success?: boolean };
export async function updateMemberAccess(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  const parsed=memberChangeSchema.safeParse({userId:form.get("userId"),expectedRole:form.get("expectedRole"),expectedStatus:form.get("expectedStatus"),role:form.get("role"),status:form.get("status"),confirm:form.get("confirm")});
  if(!parsed.success) return {error:"Check the access settings and confirm the change."};
  const {user,business,membership,supabase}=await getWorkspace();
  if(form.get("expectedBusinessId") !== business.id) return {error:"Your workspace changed. Reload and try again."};
  const v=parsed.data;
  if(v.expectedRole===v.role && v.expectedStatus===v.status) return {error:"Choose a change before confirming."};
  if(!canChangeMember(membership.role,user.id,v.userId,v.expectedRole,v.role)) return {error:"You cannot change this membership."};
  const {data,error}=await supabase.rpc("set_member_access_if_current",{p_business_id:business.id,p_user_id:v.userId,p_expected_role:v.expectedRole,p_expected_status:v.expectedStatus,p_role:v.role,p_status:v.status});
  if(error || !data || data.user_id!==v.userId || data.business_id!==business.id || data.role!==v.role || data.status!==v.status) return {error:"Could not confirm the change. Access may have changed; reload and check the member before retrying."};
  revalidatePath("/workspace/team");
  return {success:true};
}
