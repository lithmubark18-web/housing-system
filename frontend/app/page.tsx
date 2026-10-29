"use client";

import { useEffect, useState } from "react";
import { Building2, KeyRound, LockKeyhole, ShieldCheck, UserRound, Wifi, WifiOff } from "lucide-react";
import { getStoredUser } from "@/lib/api";
import {
  backendBaseUrl,
  getCachedSnapshot,
  hasLocalPin,
  isOnline,
  loadLocalSession,
  setLocalPin,
  storeLocalSession,
  tryOnlineLogin,
  verifyLocalPin,
  type OfflineUser,
} from "@/lib/offlineStore";
import { homeForRole, routePath } from "@/lib/nav";

type Phase = "signin" | "verify_pin" | "set_pin";

function digits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pins, setPins] = useState(["", ""]);
  const [phase, setPhase] = useState<Phase>("signin");
  const [pending, setPending] = useState<OfflineUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);

  const goHome = (user: OfflineUser) => {
    const target = user.mustChangePassword ? "/change-password" : homeForRole(user);
    window.location.assign(routePath(target));
  };

  useEffect(() => {
    setOnline(isOnline());
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    const token = window.localStorage.getItem("access_token");
    const stored = getStoredUser();
    const session = loadLocalSession();
    const cached = getCachedSnapshot();

    if (token && stored) {
      goHome(stored as unknown as OfflineUser);
      return;
    }
    if (session && cached) {
      goHome(session);
      return;
    }
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (phase !== "signin") return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await tryOnlineLogin(username.trim(), password);
      if (result.ok) {
        if (result.user.mustChangePassword) {
          window.location.assign(routePath("/change-password"));
          return;
        }
        if (!hasLocalPin(result.user.username)) {
          setPending(result.user);
          setPins(["", ""]);
          setPhase("set_pin");
          setNotice("يمكنك ضبط رمز PIN للدخول دون إنترنت على هذا الجهاز (اختياري).");
          return;
        }
        goHome(result.user);
        return;
      }

      if (result.code === "unauthorized") {
        setError("اسم المستخدم أو كلمة المرور غير صحيحة");
        return;
      }

      // تعذر الوصول للخادم: نسمح بالدخول المحلي فقط لحساب موجود في النسخة
      // المحفوظة وله رمز PIN مُعدّ مسبقاً على هذا الجهاز.
      const cached = getCachedSnapshot();
      const known = cached?.bootstrap?.users?.find(
        (item) => item.username.toLowerCase() === username.trim().toLowerCase(),
      );
      if (!cached || !known) {
        setError(
          `تعذر الاتصال بالخادم (${backendBaseUrl() || "بدون رابط"}). لا توجد نسخة محفوظة لهذا الحساب — سجّل الدخول عبر الشبكة أولاً.`,
        );
        return;
      }
      if (!hasLocalPin(known.username)) {
        setError("لا يوجد رمز PIN محفوظ لهذا الحساب على الجهاز — سجّل الدخول عبر الشبكة أولاً.");
        return;
      }
      setPending({
        id: known.id,
        name: known.name,
        username: known.username,
        role: known.role,
        roleId: known.roleId,
        roleName: known.roleName,
        contractorId: known.contractorId,
        permissions: known.permissions,
      });
      setPins(["", ""]);
      setPhase("verify_pin");
      setNotice("وضع العمل دون إنترنت — أدخل رمز PIN الخاص بهذا الجهاز.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر الاتصال بالخادم. حاول مجدداً.");
    } finally {
      setLoading(false);
    }
  }

  async function submitPin() {
    if (!pending) return;
    if (phase === "set_pin") {
      if (pins[0].length !== 4) return;
      if (pins[0] !== pins[1]) {
        setError("رمز التأكيد غير مطابق — أعد إدخال الرمز");
        return;
      }
      await setLocalPin(pins[0], pending.username);
      goHome(pending);
      return;
    }
    if (phase === "verify_pin") {
      if (pins[0].length !== 4) return;
      const valid = await verifyLocalPin(pins[0], pending.username);
      if (!valid) {
        setError("رمز الدخول غير صحيح");
        return;
      }
      storeLocalSession(pending);
      goHome(pending);
    }
  }

  const pinReady = phase === "set_pin" ? pins[0].length === 4 && pins[1].length === 4 : pins[0].length === 4;

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">
          <Building2 size={29} />
        </div>
        <div className="eyebrow" style={{ textAlign: "center" }}>
          HOUSING MANAGEMENT SYSTEM
        </div>
        <h1>نظام إدارة سكن الموظفين</h1>

        {phase === "signin" ? (
          <>
            <p className="muted">سجّل الدخول للوصول إلى السكن والسكان والطلبات والتقارير</p>
            <form onSubmit={submit} className="stack-lg">
              <label className="field">
                <span>اسم المستخدم</span>
                <div className="input-wrap">
                  <UserRound size={19} />
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="مثال: admin"
                    required
                  />
                </div>
              </label>

              <label className="field">
                <span>كلمة المرور</span>
                <div className="input-wrap">
                  <LockKeyhole size={19} />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </label>

              {notice && <div className="alert success">{notice}</div>}
              {error && <div className="alert danger">{error}</div>}

              <div className={`online-pill ${online ? "" : "offline"}`}>
                <span className="live-dot" />
                {online ? "متصل بالشبكة" : "لا يوجد اتصال — يمكن الدخول برمز PIN المحفوظ"}
              </div>

              <button className="primary-btn large" disabled={loading}>
                {loading ? "جارٍ الدخول..." : "تسجيل الدخول"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="muted" style={{ textAlign: "center" }}>
              الحساب: <strong>{pending?.name}</strong> ({pending?.username})
            </p>
            <p className="muted" style={{ textAlign: "center" }}>
              {phase === "set_pin"
                ? "اضبط رمز PIN مكوّناً من 4 أرقام للدخول المحلي على هذا الجهاز"
                : "أدخل رمز PIN الخاص بهذا الجهاز للدخول دون إنترنت"}
            </p>
            <div className="stack-lg">
              <label className="field">
                <span>رمز PIN</span>
                <div className="input-wrap">
                  <KeyRound size={19} />
                  <input
                    inputMode="numeric"
                    type="password"
                    value={pins[0]}
                    onChange={(event) => setPins([digits(event.target.value), pins[1]])}
                    placeholder="••••"
                    autoFocus
                  />
                </div>
              </label>
              {phase === "set_pin" && (
                <label className="field">
                  <span>تأكيد رمز PIN</span>
                  <div className="input-wrap">
                    <ShieldCheck size={19} />
                    <input
                      inputMode="numeric"
                      type="password"
                      value={pins[1]}
                      onChange={(event) => setPins([pins[0], digits(event.target.value)])}
                      placeholder="••••"
                    />
                  </div>
                </label>
              )}
              {notice && <div className="alert success">{notice}</div>}
              {error && <div className="alert danger">{error}</div>}
              <button className="primary-btn large" onClick={submitPin} disabled={loading || !pinReady}>
                {loading ? "جارٍ التحقق..." : phase === "set_pin" ? "حفظ والدخول" : "دخول محلي"}
              </button>
              <button
                className="link-btn"
                type="button"
                onClick={() => {
                  if (phase === "set_pin") {
                    goHome(pending!);
                    return;
                  }
                  setPhase("signin");
                  setPending(null);
                  setPins(["", ""]);
                  setError("");
                  setNotice("");
                }}
              >
                {phase === "set_pin" ? "تخطي — الدخول الآن" : "رجوع"}
              </button>
            </div>
          </>
        )}

        <div className="login-foot">
          {online ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{online ? "الخادم متاح" : "وضع دون إنترنت"}</span>
          <span className="dot-sep">·</span>
          <span>الإصدار 2.0.0</span>
        </div>
      </section>
    </main>
  );
}
