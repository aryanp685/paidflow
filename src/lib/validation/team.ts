import { z } from "zod";
export const memberRoles = ["owner", "admin", "manager", "accountant", "viewer"] as const;
export const memberStatuses = ["active", "suspended"] as const;
export const memberChangeSchema = z.object({ userId: z.uuid(), expectedRole: z.enum(memberRoles), expectedStatus: z.enum(memberStatuses), role: z.enum(memberRoles), status: z.enum(memberStatuses), confirm: z.literal("yes") });
export function canManageTeam(role: string) { return role === "owner" || role === "admin"; }
export function canChangeMember(actorRole: string, actorId: string, targetId: string, targetRole: string, newRole: string) {
  return canManageTeam(actorRole) && actorId !== targetId && targetRole !== "owner" && newRole !== "owner" && (actorRole === "owner" || (targetRole !== "admin" && newRole !== "admin"));
}
