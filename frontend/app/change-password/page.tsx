"use client";

import { useEffect, useState } from "react";
import { Building2, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { changePassword, getStoredUser, logoutLocal } from "@/lib/api";
import { homeForRole, routePath } from "@/lib/nav";

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!window.localStorage.getItem("access_token")) {
      window.location.assign("/");
      return;
    }
    setReady(true);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("تأكيد كلمة المرور غير مطابق");
      return;
    }
    if (next.trim().length < 6) {
      setError("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    setLoading(true);
    try {
      const result = await changePassword(current, next);
      const user = result.user || getStoredUser();
      window.location.assign(routePath(user ? homeForRole(user) : "/dashboard"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تغيير كلمة المرور");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return <main className="login-shell"><div className="login-card">جارٍ التحقق...</div></main>;

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">
          <Building2 size={29} />
        </div>
        <div className="eyebrow" style={{ textAlign: "center" }}>
          HOUSING MANAGEMENT SYSTEM
        </div>
        <h1>تغيير كلمة المرور</h1>
        <p className="muted" style={{ textAlign: "center" }}>
          لحماية حسابك، اختر كلمة مرور جديدة لا تقل عن 6 أحرف.
        </p>

        <form onSubmit={submit} className="stack-lg">
          <label className="field">
            <span>كلمة المرور الحالية</span>
            <div className="input-wrap">
              <LockKeyhole size={19} />
              <input
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          </label>
          <label className="field">
            <span>كلمة المرور الجديدة</span>
            <div className="input-wrap">
              <KeyRound size={19} />
              <input
                type="password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </label>
          <label className="field">
            <span>تأكيد كلمة المرور الجديدة</span>
            <div className="input-wrap">
              <ShieldCheck size={19} />
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </label>

          {error && <div className="alert danger">{error}</div>}

          <button className="primary-btn large" disabled={loading}>
            {loading ? "جارٍ الحفظ..." : "حفظ كلمة المرور والدخول"}
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              logoutLocal();
              window.location.assign("/");
            }}
          >
            تسجيل الخروج
          </button>
        </form>
      </section>
    </main>
  );
}
