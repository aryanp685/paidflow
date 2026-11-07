import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getLab, getLabSession, isLabHost } from "@/lib/better-auth-lab/server";
import { AuthFrame } from "@/components/auth/auth-frame";
import { LabForm, type LabScreen } from "@/components/better-auth-lab/lab-form";
export const dynamic = "force-dynamic";
export default async function Page({params}: {params: Promise<{screen:string}>}) {
  if (process.env.NODE_ENV === "production" || process.env.PAIDFLOW_BA_LAB_ENABLED !== "1") notFound();
  const {screen}=await params;
  if (!["login","signup","forgot-password","reset-password","verify-email","workspace","onboard"].includes(screen)) notFound();
  const requestHeaders=await headers(); if (!isLabHost(requestHeaders)) notFound();
  const lab=await getLab(); if (!lab) notFound();
  if (screen === "workspace" || screen === "onboard") { const session=await getLabSession(lab, requestHeaders); if(!session?.user?.id || !session.user.emailVerified) redirect("/better-auth-lab/login"); }
  return <AuthFrame><LabForm screen={screen as LabScreen} storageEnabled={process.env.PAIDFLOW_STORAGE_LAB_ENABLED === "1"}/></AuthFrame>;
}
