"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Bell,
  BookOpen,
  Building2,
  ChartColumn,
  CheckCheck,
  ClipboardList,
  CloudUpload,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { backendBaseUrl } from "@/lib/offlineStore";
import { globalSearch, type SearchGroupItem } from "@/lib/api";
import { routePath } from "@/lib/nav";
import { can, canAny, roleLabel } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import { timeAgo } from "@/lib/format";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  any?: string[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "لوحة المعلومات", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/residents", label: "السكان والموظفون", icon: UsersRound, permission: "residents.view" },
  { href: "/housing", label: "السكن والأسرّة", icon: Building2, permission: "housing.view" },
  { href: "/operations", label: "المتابعة والحضور", icon: ClipboardList, permission: "operations.view" },
  {
    href: "/requests",
    label: "الطلبات والاعتمادات",
    icon: ShieldCheck,
    any: ["requests.supervise", "requests.security", "requests.visitor", "requests.housing_internal", "requests.housing_external"],
  },
  { href: "/contractors", label: "المتعهدون", icon: Handshake, any: ["contractors.manage", "housing.view"] },
  { href: "/guests", label: "بوابة الزوار", icon: UserRound, any: ["guests.view", "guests.manage"] },
  { href: "/reports", label: "التقارير والتحليلات", icon: ChartColumn, permission: "reports.view" },
  { href: "/admin", label: "إدارة النظام", icon: Settings, any: ["admin.users", "admin.settings", "admin.backup"] },
  { href: "/about", label: "الدليل", icon: BookOpen },
];

const GROUP_LABELS: Record<string, string> = {
  residents: "السكان",
  housing: "السكن",
  contractors: "المتعهدون",
  requests: "الطلبات",
  users: "المستخدمون",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, data, notifications, unread, offline, serverReachable, online, pending, replayNow, refresh, reload, logout, readAll, markRead } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<Record<string, SearchGroupItem[]>>({});
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const notifyRef = useRef<HTMLDivElement | null>(null);

  const nav = useMemo(() => {
    const items = NAV_ITEMS.filter((item) => {
      if (!user) return false;
      if (item.permission) return can(user, item.permission);
      if (item.any) return canAny(user, item.any);
      return true;
    });
    const isPureContractor = can(user, "contractor.portal") && !can(user, "dashboard.view");
    if (isPureContractor) {
      return [{ href: "/contractor", label: "بوابة المتعهد", icon: Handshake }, { href: "/about", label: "الدليل", icon: BookOpen }];
    }
    return items;
  }, [user]);

  const pendingRequests = data?.meta?.pendingCounts?.total || 0;
  const serverHost = useMemo(() => {
    try {
      return new URL(backendBaseUrl() || "").host || "";
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setNotificationsOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
      if (notifyRef.current && !notifyRef.current.contains(target)) setNotificationsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults({});
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await globalSearch(term, 6);
        if (!cancelled) {
          setResults(result.groups || {});
          setSearchOpen(true);
        }
      } catch {
        if (!cancelled) setResults({});
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  const toggleNotifications = async () => {
    const next = !notificationsOpen;
    setNotificationsOpen(next);
    if (next) await refresh(true);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mini">
            <Building2 size={21} />
          </div>
          <div>
            <strong>إدارة السكن</strong>
            <small>Housing System 2.2</small>
          </div>
          <button type="button" className="sidebar-close" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة">
            <X size={18} />
          </button>
        </div>

        <nav>
          {nav.map(({ href, label, icon: Icon }) => {
            const [base] = href.split("?");
            const active = pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/`);
            return (
              <a key={href} href={routePath(href)} className={active ? "nav-link active" : "nav-link"}>
                <Icon size={19} />
                <span>{label}</span>
                {href === "/requests" && pendingRequests > 0 && <b className="nav-count">{pendingRequests}</b>}
              </a>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{(user?.name || "؟").slice(0, 1)}</div>
            <div>
              <strong>{user?.name || "المستخدم"}</strong>
              <small>{roleLabel(user?.roleId, user?.roleName)}</small>
            </div>
          </div>
          <div className={`mode-chip ${offline ? "offline" : ""}`} title={`الخادم: ${serverHost}`}>
            <span className="live-dot" />
            {offline
              ? serverReachable
                ? "الخادم متاح · أعد الدخول للمزامنة"
                : "وضع دون إنترنت"
              : `متصل · ${data?.meta?.mode === "postgres" ? "PostgreSQL" : "محلي"} · ${serverHost}`}
            {pending > 0 ? ` · ${pending} معلّق` : ""}
          </div>
          <button type="button" className="logout-link" onClick={logout}>
            <LogOut size={18} /> خروج
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar">
          <button type="button" className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="القائمة">
            <Menu size={20} />
          </button>

          <div className="topbar-search" ref={searchRef}>
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => search.trim().length >= 2 && setSearchOpen(true)}
              placeholder="بحث شامل: ساكن، مبنى، متعهد، طلب..."
            />
            {searching && <span className="mini-spinner" />}
            {searchOpen && search.trim().length >= 2 && (
              <div className="search-results">
                {Object.keys(results).length === 0 && !searching && <div className="search-empty">لا توجد نتائج مطابقة</div>}
                {Object.entries(results).map(([group, items]) => (
                  <div key={group} className="search-group">
                    <small>{GROUP_LABELS[group] || group}</small>
                    {items.map((item) => (
                      <a key={`${group}-${item.id}`} href={routePath(item.href)} onClick={() => setSearchOpen(false)}>
                        <strong>{item.title}</strong>
                        {item.subtitle && <span>{item.subtitle}</span>}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="topbar-actions">
            {pending > 0 && (
              <button
                type="button"
                className="topbar-icon"
                onClick={() => void replayNow()}
                title={`${pending} إجراء بانتظار المزامنة — انقر للمزامنة الآن`}
              >
                <CloudUpload size={18} />
                <b className="dot-badge warn">{pending > 99 ? "99+" : pending}</b>
              </button>
            )}
            <button type="button" className="topbar-icon" onClick={() => refresh(true)} title="تحديث البيانات">
              <RefreshCw size={18} />
            </button>
            <div className="notify-wrap" ref={notifyRef}>
              <button type="button" className="topbar-icon" onClick={toggleNotifications} title="الإشعارات">
                <Bell size={18} />
                {unread > 0 && <b className="dot-badge">{unread > 99 ? "99+" : unread}</b>}
              </button>
              {notificationsOpen && (
                <div className="notify-panel">
                  <div className="notify-head">
                    <strong>الإشعارات</strong>
                    {unread > 0 && (
                      <button type="button" onClick={() => readAll()} className="link-btn">
                        <CheckCheck size={15} /> قراءة الكل
                      </button>
                    )}
                  </div>
                  <div className="notify-list">
                    {!notifications.length && <div className="search-empty">لا توجد إشعارات</div>}
                    {notifications.slice(0, 25).map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`notify-item ${item.read ? "" : "unread"}`}
                        onClick={() => {
                          if (!item.read) markRead(item.id);
                          if (item.link) window.location.assign(routePath(item.link));
                        }}
                      >
                        <div>
                          <strong>{item.title}</strong>
                          {item.body && <span>{item.body}</span>}
                          <small>{timeAgo(item.createdAt)}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="topbar-user">
              <div className="avatar">{(user?.name || "؟").slice(0, 1)}</div>
              <div>
                <strong>{user?.name}</strong>
                <small>{roleLabel(user?.roleId, user?.roleName)}</small>
                <span aria-hidden="true" />
              </div>
              <button
                type="button"
                className="icon-plain danger"
                title="تسجيل الخروج"
                aria-label="تسجيل الخروج"
                onClick={() => logout()}
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>

        {(!online || offline) && (
          <div className="offline-banner">
            <WifiOff size={16} />
            <span>
              {offline
                ? serverReachable
                  ? "الخادم متاح الآن — الجلسة الحالية محلية (دخول عبر PIN) بلا توكن. أعد تسجيل الدخول لبيانات حية ومزامنة، أو تابع بوضع القراءة فقط."
                  : "تعذر الاتصال بالخادم — أنت تستعرض نسخة محفوظة للقراءة فقط. عدّل البيانات عبر الشبكة."
                : "لا يوجد اتصال بالإنترنت — ستُعرض البيانات المحفوظة عند التحديث."}
            </span>
            {offline && serverReachable && (
              <button type="button" className="link-btn" onClick={() => logout()}>
                إعادة تسجيل الدخول
              </button>
            )}
            <button type="button" className="link-btn" onClick={() => reload()}>
              إعادة المحاولة
            </button>
            <button type="button" className="link-btn" onClick={() => logout()}>
              <LogOut size={14} /> خروج
            </button>
          </div>
        )}

        {children}

        <footer className="app-footer">
          <span>نظام إدارة سكن الموظفين · الإصدار {data?.meta?.version || "2.1.0"}</span>
          <span>{data?.meta?.serverTime ? `وقت الخادم: ${timeAgo(data.meta.serverTime)}` : ""}</span>
        </footer>
      </main>
      {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} />}
    </div>
  );
}
