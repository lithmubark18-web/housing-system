"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Loader } from "@/components/ui";
import { homeForRole, routePath } from "@/lib/nav";
import { can, canAny } from "@/lib/permissions";
import { AppProvider, useApp } from "@/lib/store";
import type { User } from "@/lib/types";

/** صلاحيات الوصول لكل صفحة — تمنع فتح الصفحات مباشرة عبر الرابط خارج نطاق الدور. */
const ROUTE_ACCESS: Array<{ path: string; permission?: string; any?: string[] }> = [
  { path: "/dashboard", permission: "dashboard.view" },
  { path: "/residents", any: ["residents.view", "residents.manage"] },
  { path: "/housing", any: ["housing.view", "housing.manage"] },
  { path: "/operations", permission: "operations.view" },
  {
    path: "/requests",
    any: [
      "requests.supervise",
      "requests.department",
      "requests.security",
      "requests.visitor",
      "requests.housing_internal",
      "requests.housing_external",
    ],
  },
  { path: "/contractors", any: ["contractors.manage", "contractors.view", "housing.view"] },
  { path: "/guests", any: ["guests.view", "guests.manage"] },
  { path: "/reports", permission: "reports.view" },
  { path: "/admin", any: ["admin.users", "admin.settings", "admin.backup", "audit.view"] },
  { path: "/settings", permission: "admin.settings" },
  { path: "/contractor", any: ["contractor.portal", "contractors.manage"] },
];

function canOpen(user: User | null, pathname: string): boolean {
  if (!user) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/about" || path === "") return true;
  const rule = ROUTE_ACCESS.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  if (!rule) return true;
  if (rule.permission) return can(user, rule.permission);
  if (rule.any) return canAny(user, rule.any);
  return true;
}

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading, offline } = useApp();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      window.location.assign("/");
      return;
    }
    if (user.mustChangePassword && !window.location.pathname.startsWith("/change-password")) {
      window.location.assign("/change-password");
      return;
    }
    if (!canOpen(user, pathname)) {
      window.location.assign(routePath(homeForRole(user)));
    }
  }, [user, loading, offline, pathname]);

  if (loading && !user) return <Loader label="جارٍ تحميل بيانات النظام..." />;
  if (!user) return <Loader label="جارٍ التحقق من الجلسة..." />;
  if (!canOpen(user, pathname)) return <Loader label="جارٍ التحويل إلى صفحتك..." />;

  return <AppShell>{children}</AppShell>;
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Guard>{children}</Guard>
    </AppProvider>
  );
}
