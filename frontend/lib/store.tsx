"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiLogin,
  clearSession,
  getBootstrap,
  getStoredUser,
  healthProbe,
  logoutLocal,
  readAllNotifications,
  readNotification,
  storeSession,
} from "./api";
import {
  clearCachedSnapshot,
  clearLocalSession,
  getCachedSnapshot,
  hasLocalPin,
  isOnline,
  loadLocalSession,
  saveCachedSnapshot,
  storeLocalSession,
  type CachedSnapshot,
} from "./offlineStore";
import type { Bootstrap, Notification, User } from "./types";

type AppContextValue = {
  user: User | null;
  data: Bootstrap | null;  notifications: Notification[];
  unread: number;
  loading: boolean;
  offline: boolean;
  /** الخادم متاح لكن الجلسة المحلية بلا توكن (دخول عبر PIN) — يلزم إعادة الدخول للمزامنة */
  serverReachable: boolean;
  error: string;
  online: boolean;
  /** آخر وقت تحديث للبيانات */
  syncedAt: string | null;
  refresh: (silent?: boolean) => Promise<boolean | void>;
  reload: () => Promise<void>;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  readAll: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  setUser: (user: User | null) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (!window.location.pathname.endsWith("/index.html") && window.location.pathname === "/") return;
  window.location.assign("/");
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUserState] = useState<User | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [serverReachable, setServerReachable] = useState(false);
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const inflight = useRef(false);
  const offlineRef = useRef(false);
  const mounted = useRef(true);

  const applyBootstrap = useCallback((payload: Bootstrap, isOffline: boolean) => {
    setData(payload);
    const nextUser = payload.user || null;
    setUserState(nextUser);
    if (nextUser) {
      storeLocalSession({
        id: nextUser.id,
        name: nextUser.name,
        username: nextUser.username,
        role: nextUser.role,
        roleId: nextUser.roleId,
        roleName: nextUser.roleName,
        contractorId: nextUser.contractorId,
        permissions: nextUser.permissions,
      });
    }
    setOffline(isOffline);
    offlineRef.current = isOffline;
    setSyncedAt(new Date().toISOString());
  }, []);

  const refresh = useCallback(
    async (silent = false) => {
      if (inflight.current) return;
      const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
      if (!token) {
        const cached = getCachedSnapshot();
        const session = loadLocalSession();
        if (cached?.bootstrap && session) {
          applyBootstrap(cached.bootstrap, true);
          // لا نحفظ كلمات المرور أمنياً، لذا لا يمكن إعادة الدخول الصامت.
          // نُجسّر الخادم إن رجع لنطلب إعادة الدخول للمزامنة بدل "دون إنترنت" المضلِّلة.
          healthProbe().then((ok) => {
            if (ok && mounted.current) setServerReachable(true);
          }).catch(() => {});
          setLoading(false);
          return true;
        }
        setLoading(false);
        redirectToLogin();
        return false;
      }
      inflight.current = true;
      if (!silent) setLoading(true);
      try {
        const payload = await getBootstrap();
        if (!mounted.current) return false;
        applyBootstrap(payload, false);
        setServerReachable(false);
        saveCachedSnapshot(payload, payload.meta?.counts);
        setError("");
        return true;
      } catch (err) {
        if (!mounted.current) return false;
        const cached = getCachedSnapshot();
        const session = loadLocalSession();
        if (cached?.bootstrap && session) {
          applyBootstrap(cached.bootstrap, true);
          setError("تم عرض نسخة محفوظة من البيانات — تعذر الاتصال بالخادم");
          return true;
        }
        setError(err instanceof Error ? err.message : "تعذر تحميل البيانات");
        const stored = getStoredUser();
        if (!stored) redirectToLogin();
        return false;
      } finally {
        inflight.current = false;
        if (mounted.current) setLoading(false);
      }
    },
    [applyBootstrap],
  );

  useEffect(() => {
    mounted.current = true;
    setOnline(isOnline());
    // مرجع لحالة "دون اتصال" ليعيد المحاولة تلقياً عند عودة الخادم دون تمريرها عبر الاعتماديات.
    let offlineNow = false;
    const goOnline = () => {
      setOnline(true);
      refresh(true).catch(() => {});
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    refresh().catch(() => {});
    // إعادة محاولة دورية خفيفة كل 15 ثانية عند العمل بحالة "دون اتصال".
    const timer = setInterval(() => {
      if (offlineRef.current) refresh(true).catch(() => {});
    }, 15000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await apiLogin(username, password);
      const bootstrap = await getBootstrap();
      applyBootstrap(bootstrap, false);
      setServerReachable(false);
      saveCachedSnapshot(bootstrap, bootstrap.meta?.counts);
      return result.user;
    } finally {
      setLoading(false);
    }
  }, [applyBootstrap]);

  const logout = useCallback(() => {
    logoutLocal();
    clearLocalSession();
    setServerReachable(false);
    // نُبقي النسخة المحلية إن كان للمستخدم رمز PIN — حتى يعمل الدخول دون
    // إنترنت عبر شاشة الدخول بعد الخروج (البيانات محميّة برمز PIN).
    const keepOfflineSnapshot = typeof window !== "undefined" && user ? hasLocalPin(user.username) : false;
    if (!keepOfflineSnapshot) clearCachedSnapshot();
    setUserState(null);
    setData(null);
    router.replace("/");
  }, [router, user]);

  const reload = useCallback(async () => {
    await refresh(true);
  }, [refresh]);

  const setUser = useCallback((next: User | null) => {
    setUserState(next);
    if (next && typeof window !== "undefined") {
      storeSession({ user: next });
    }
  }, []);

  const readAll = useCallback(async () => {
    await readAllNotifications();
    await refresh(true);
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    await readNotification(id);
    await refresh(true);
  }, [refresh]);

  const notifications = useMemo(() => data?.notifications || [], [data]);
  const unread = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      data,
      notifications,
      unread,
      loading,
      offline,
      serverReachable,
      error,
      online,
      syncedAt,
      refresh,
      reload,
      login,
      logout,
      readAll,
      markRead,
      setUser,
    }),
    [user, data, notifications, unread, loading, offline, serverReachable, error, online, syncedAt, refresh, reload, login, logout, readAll, markRead, setUser],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp يجب أن يُستخدم داخل AppProvider");
  return context;
}

export function useCachedSnapshot(): CachedSnapshot | null {
  return useMemo(() => getCachedSnapshot(), []);
}

export function clearAllLocalData() {
  clearSession();
  clearLocalSession();
  clearCachedSnapshot();
}
