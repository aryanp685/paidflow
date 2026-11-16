"use client";
import { useActionState, useState } from "react";
import { updateMemberAccess, type TeamActionState } from "@/app/(workspace)/workspace/team/actions";
import type { Database } from "@/lib/supabase/database.types";
type Role=Database["public"]["Enums"]["business_role"];
type Status=Database["public"]["Enums"]["member_status"];
const initial: TeamActionState={};
export function MemberAccessForm({businessId,userId,role,status,actorRole}:{businessId:string;userId:string;role:Role;status:Status;actorRole:string}) {
  const [state,action,pending]=useActionState(updateMemberAccess,initial);
  const [nextRole,setNextRole]=useState(role),[nextStatus,setNextStatus]=useState(status),[confirmed,setConfirmed]=useState(false);
  if(state.success) return <p role="status">Access updated. Reload the team page to review current access before making another change.</p>;
  return <form action={action} onReset={e=>e.preventDefault()} className="team-access-form">
    <input type="hidden" name="expectedBusinessId" value={businessId} /><input type="hidden" name="userId" value={userId} /><input type="hidden" name="expectedRole" value={role} /><input type="hidden" name="expectedStatus" value={status} />
    <label>Role<select name="role" value={nextRole} onChange={e=>{setNextRole(e.target.value as Role);setConfirmed(false);}}>{actorRole === "owner" && <option value="admin">Admin</option>}<option value="manager">Manager</option><option value="accountant">Accountant</option><option value="viewer">Viewer</option></select></label>
    <label>Status<select name="status" value={nextStatus} onChange={e=>{setNextStatus(e.target.value as Status);setConfirmed(false);}}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
    <label className="team-confirm"><input type="checkbox" name="confirm" value="yes" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required /> Confirm this member access change</label>
    {state.error && <p role="alert" className="customer-error">{state.error}</p>}
    <button type="submit" disabled={pending || !confirmed || (nextRole===role && nextStatus===status)}>{pending ? "Saving…" : "Update access"}</button>
  </form>;
}
