"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiLogin,
  clearSession,
  getBootstrap,
  getBootstrapVersion,
  getStoredUser,
  healthProbe,
  logoutLocal,
  notificationUnreadCount,
  readAllNotifications,
  readNotification,
  replayPendingActions,
  storeSession,
} from "./api";
import {
  clearCachedSnapshot,
  clearGuestsCache,
  clearLocalSession,
  getCachedSnapshot,
  getPendingActions,
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
  /** عدد الإجراءات المحفوظة محلياً بانتظار المزامنة مع الخادم */
  pending: number;
  /** إعادة إرسال الطابور يدوياً فوراً */
  replayNow: () => Promise<void>;
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
  const [pending, setPending] = useState(0);
  const inflight = useRef(false);
  const offlineRef = useRef(false);
  const mounted = useRef(true);
  /** آخر إشارة تغيّر قادمة من الخادم (عدادات + إشعارات لم تُقرأ) لتفادي إعادة التحميل بلا داعٍ */
  const lastSignalRef = useRef<string>("");
  /** مرجع لأحدث payload حتى يقرأ المؤقت الدوري الحالة الجديدة دون إعادة تسجيل المؤقت */
  const dataRef = useRef<Bootstrap | null>(null);

  /** إشارة تغيّر البيانات: إشعارات لم تُقرأ + عدادات الخادم + عدادات مراحل الطلبات */
  function signalOf(payload: Bootstrap | null, serverSignal?: Partial<{ counts: Record<string, number>; pendingCounts: Record<string, number>; unread: number }>): string {
    const unread =
      serverSignal?.unread !== undefined
        ? serverSignal.unread
        : (payload?.notifications || []).filter((item) => !item.read).length;
    return JSON.stringify({
      unread,
      counts: serverSignal?.counts || payload?.meta?.counts || {},
      pending: serverSignal?.pendingCounts || payload?.meta?.pendingCounts || {},
    });
  }

  const applyBootstrap = useCallback((payload: Bootstrap, isOffline: boolean) => {
    setData(payload);
    dataRef.current = payload;
    lastSignalRef.current = signalOf(payload);
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
    setPending(getPendingActions().length);
    // مرجع لحالة "دون اتصال" ليعيد المحاولة تلقياً عند عودة الخادم دون تمريرها عبر الاعتماديات.
    let offlineNow = false;
    const syncPendingCount = () => setPending(getPendingActions().length);
    const tryReplay = async () => {
      if (!isOnline()) return;
      if (!getPendingActions().length) {
        syncPendingCount();
        return;
      }
      try {
        const done = await replayPendingActions();
        syncPendingCount();
        if (done > 0) await refresh(true);
      } catch {
        /* الدورة التالية من المؤقت ستعيد المحاولة */
      }
    };
    const goOnline = () => {
      setOnline(true);
      tryReplay().finally(() => refresh(true).catch(() => {}));
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    refresh().catch(() => {});
    // فحص دوري خفيف كل 20 ثانية:
    // - دون إنترنت (دخول PIN): إعادة محاولة المزامنة عند عودة الخادم.
    // - متصل: مقارنة إشارة خفيفة (عدادات الخادم + إشعارات لم تُقرأ) وتحديث صامت كامل عند أي تغيّر.
    const timer = setInterval(async () => {
      if (inflight.current) return;
      syncPendingCount();
      void tryReplay();
      if (offlineRef.current) {
        refresh(true).catch(() => {});
        return;
      }
      const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
      if (!token || !isOnline()) return;
      try {
        const [versionRes, unreadRes] = await Promise.all([
          getBootstrapVersion(),
          notificationUnreadCount(),
        ]);
        if (!mounted.current || inflight.current) return;
        const serverSignal = signalOf(null, {
          counts: versionRes.counts,
          pendingCounts: versionRes.pendingCounts,
          unread: unreadRes.unread,
        });
        if (serverSignal === lastSignalRef.current) {
          setSyncedAt(new Date().toISOString());
          return;
        }
        const ok = await refresh(true);
        if (ok && mounted.current) lastSignalRef.current = serverSignal;
      } catch {
        /* تعذر الوصول للخادم — ننتظر الدورة التالية */
      }
    }, 20000);
    // عند العودة للتبويب/التطبيق: فحص فوري بدل انتظار الدورة التالية.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (inflight.current) return;
      const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
      if (!token) return;
      syncPendingCount();
      void tryReplay();
      refresh(true).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
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
    if (!keepOfflineSnapshot) {
      clearCachedSnapshot();
      clearGuestsCache();
    }
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

  const replayNow = useCallback(async () => {
    if (!getPendingActions().length) {
      setPending(0);
      return;
    }
    try {
      await replayPendingActions();
      setPending(getPendingActions().length);
      await refresh(true);
    } catch {
      /* يُعاد المحاولة لاحقاً */
    }
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
      pending,
      syncedAt,
      refresh,
      reload,
      login,
      logout,
      readAll,
      markRead,
      replayNow,
      setUser,
    }),
    [user, data, notifications, unread, loading, offline, serverReachable, error, online, pending, syncedAt, refresh, reload, login, logout, readAll, markRead, replayNow, setUser],
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
  clearGuestsCache();
}
