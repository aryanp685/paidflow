export const dynamic = "force-dynamic";
import { redirect } from "next/navigation"; import { requireUser } from "@/lib/supabase/guard"; import { OnboardingWizard } from "@/components/onboarding/wizard";
export default async function OnboardingPage() { const { user,supabase }=await requireUser(); const {data,error}=await supabase.from("business_members").select("business_id").eq("user_id",user.id).eq("status","active").limit(1); if(error) throw new Error("Unable to verify workspace access."); if(data?.length) redirect("/workspace"); return <OnboardingWizard userId={user.id}/>; }
