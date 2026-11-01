"use client";

import { useEffect } from "react";
import AppShell from "@/components/AppShell";
import { Loader } from "@/components/ui";
import { AppProvider, useApp } from "@/lib/store";

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading, offline } = useApp();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      window.location.assign("/");
      return;
    }
    if (user.mustChangePassword && !window.location.pathname.startsWith("/change-password")) {
      window.location.assign("/change-password");
    }
  }, [user, loading, offline]);

  if (loading && !user) return <Loader label="جارٍ تحميل بيانات النظام..." />;
  if (!user) return <Loader label="جارٍ التحقق من الجلسة..." />;

  return <AppShell>{children}</AppShell>;
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Guard>{children}</Guard>
    </AppProvider>
  );
}
