import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, UsersRound } from "lucide-react";
import { getWorkspace } from "@/lib/supabase/guard";
import { isCompletePage } from "@/lib/data/pagination";
import { canChangeMember, canManageTeam } from "@/lib/validation/team";
import { MemberAccessForm } from "@/components/team/member-access-form";
const PAGE_SIZE=50;
export default async function TeamPage({searchParams}:{searchParams:Promise<{page?:string | string[]}>}) {
  const {user,business,membership,supabase}=await getWorkspace();
  if(!canManageTeam(membership.role)) notFound();
  const params=await searchParams;const page=Math.min(typeof params.page==="string" && /^[1-9]\d{0,3}$/.test(params.page) ? Number(params.page) : 1,1000);
  const {data,count,error}=await supabase.from("business_members").select("id,user_id,role,status,joined_at",{count:"exact"}).eq("business_id",business.id).order("joined_at",{ascending:true}).order("id",{ascending:true}).range((page-1)*PAGE_SIZE,page*PAGE_SIZE-1);
  if(error || !isCompletePage(data,count,page,PAGE_SIZE) || count==null) throw new Error("Unable to load the team. Please try again.");
  return <><div className="workspace-page-head"><div><div className="auth-kicker"><span /> YOUR WORKSPACE</div><h1>Team access</h1><p>Review existing members and their workspace permissions.</p></div></div>
    <div className="invoice-notice">Invitations, ownership transfer and member profile details are not available here. Use member IDs to identify people. Access changes affect this workspace; review the ID carefully.</div>
    <div className="customer-card"><div className="customer-card-head"><div><h2>Workspace members</h2><p>{count} {count===1 ? "membership" : "memberships"}, including suspended members</p></div><span><UsersRound size={19} /></span></div>
      {data.length ? <ul className="team-list">{data.map(member=><li key={member.id}><div className="team-member"><div><strong>{member.user_id===user.id ? "You" : "Member"}</strong><p>Member ID: <code>{member.user_id}</code></p><p>Current role: {member.role} · Status: {member.status}</p></div>{canChangeMember(membership.role,user.id,member.user_id,member.role,member.role) ? <MemberAccessForm key={`${member.id}:${member.role}:${member.status}`} businessId={business.id} userId={member.user_id} role={member.role} status={member.status} actorRole={membership.role}/> : <p className="team-restricted">This membership cannot be changed by you here.</p>}</div></li>)}</ul> : <div className="customer-empty"><h3>No members on this page</h3><p>Go back to see earlier memberships.</p></div>}
      {(page>1 || (page<1000 && page*PAGE_SIZE<count)) && <nav className="customer-pagination" aria-label="Team pages">{page>1 ? <Link href={`/workspace/team?page=${page-1}`}><ArrowLeft size={14}/> Previous</Link> : <span/>}<span>Page {page}</span>{page<1000 && page*PAGE_SIZE<count && <Link href={`/workspace/team?page=${page+1}`}>Next <ArrowRight size={14}/></Link>}</nav>}
      {page===1000 && page*PAGE_SIZE<count && <p className="draft-help">Only the first 50,000 memberships are accessible here.</p>}
    </div></>;
}
