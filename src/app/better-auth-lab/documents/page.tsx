import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLab, getLabSession } from "@/lib/better-auth-lab/server";
import { getStorageLab } from "@/lib/storage-lab/server";
import { DocumentManager } from "@/components/storage-lab/document-manager";
export const dynamic="force-dynamic";
export default async function Documents(){const h=await headers();const storage=await getStorageLab(h);const lab=await getLab();if(!storage||!lab)notFound();const session=await getLabSession(lab,h);if(!session?.user?.id||!session.user.emailVerified)redirect("/better-auth-lab/login");return <DocumentManager/>;}
