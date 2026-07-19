import { env } from "@wow-dashboard/env/api";

export const configuredAdminUserIds = env.ADMIN_USER_IDS;

const configuredAdminUserIdSet = new Set(configuredAdminUserIds);

export function isAdminIdentity(user: { id: string; role?: string | null }): boolean {
  if (configuredAdminUserIdSet.has(user.id)) {
    return true;
  }

  return (user.role ?? "")
    .split(",")
    .map((role) => role.trim().toLocaleLowerCase("en-US"))
    .includes("admin");
}
