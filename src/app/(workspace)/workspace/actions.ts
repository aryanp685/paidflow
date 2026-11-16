"use server";
import { redirect } from "next/navigation"; import { revalidatePath } from "next/cache"; import { z } from "zod"; import { requireUser } from "@/lib/supabase/guard"; import { createClient } from "@/lib/supabase/server"; import { getSupabaseConfig } from "@/lib/supabase/env";
export async function switchBusiness(formData: FormData) { const id=formData.get("businessId"); if(!z.uuid().safeParse(id).success) return; const {supabase}=await requireUser(); const {error}=await supabase.rpc("set_default_business",{p_business_id:id as string}); if(error) throw new Error("Unable to switch workspace."); revalidatePath("/workspace","layout"); redirect("/workspace"); }
export async function logout() {
  let failed = !getSupabaseConfig();
  if (!failed) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      failed = !!error;
    } catch {
      failed = true;
    }
  }
  if (failed) redirect("/login?signout=failed");
  revalidatePath("/", "layout");
  redirect("/login");
}
