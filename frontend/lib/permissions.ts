import type { User } from "./types";

export type PermissionId = string;

export const ROLE_ORDER = ["r_admin", "r_housing", "r_security", "r_visitor", "r_contractor"] as const;

export const ROLE_LABELS: Record<string, string> = {
  r_admin: "مدير النظام",
  r_housing: "مراقب السكن",
  r_security: "مشرف الأمن",
  r_visitor: "مراقب الزوار",
  r_contractor: "متعهد/مقاول",
  admin: "مدير النظام",
  housingSupervisor: "مراقب السكن",
  securitySupervisor: "مشرف الأمن",
  visitorSupervisor: "مراقب الزوار",
  contractor: "متعهد/مقاول",
};

export function roleLabel(roleId?: string | null, roleName?: string | null): string {
  if (roleName) return roleName;
  if (!roleId) return "مستخدم";
  return ROLE_LABELS[roleId] || roleId;
}

export function permissionsOf(user: Pick<User, "permissions"> | null | undefined): string[] {
  if (!user || !Array.isArray(user.permissions)) return [];
  return user.permissions;
}

export function can(user: Pick<User, "permissions"> | null | undefined, permission: PermissionId): boolean {
  return permissionsOf(user).includes(permission);
}

export function canAny(user: Pick<User, "permissions"> | null | undefined, permissions: PermissionId[]): boolean {
  const owned = new Set(permissionsOf(user));
  return permissions.some((permission) => owned.has(permission));
}

export function isAdmin(user: Pick<User, "roleId" | "role"> | null | undefined): boolean {
  if (!user) return false;
  return user.roleId === "r_admin" || user.role === "admin";
}

export function isContractor(user: Pick<User, "roleId" | "role"> | null | undefined): boolean {
  if (!user) return false;
  return user.roleId === "r_contractor" || user.role === "contractor";
}

export function isStaffLike(user: Pick<User, "permissions"> | null | undefined): boolean {
  return !isContractorOnly(user);
}

function isContractorOnly(user: Pick<User, "permissions"> | null | undefined): boolean {
  const owned = permissionsOf(user);
  return owned.includes("contractor.portal") && !owned.includes("dashboard.view") && !owned.includes("housing.view");
}
