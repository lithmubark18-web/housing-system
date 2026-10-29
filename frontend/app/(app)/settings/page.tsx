"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Database,
  HardDrive,
  KeyRound,
  LogOut,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { logoutAllDevices, saveSettings } from "@/lib/api";
import { clearCachedSnapshot, getConfig, normalizeBaseUrl, saveConfig } from "@/lib/offlineStore";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { routePath } from "@/lib/nav";
import { can, roleLabel } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { Settings } from "@/lib/types";
import {
  Alert,
  Badge,
  EmptyState,
  ErrorNote,
  Field,
  InfoGrid,
  Loader,
  PageHead,
  SectionTitle,
  TextInput,
} from "@/components/ui";

const FEATURE_LABELS: Record<string, { label: string; hint: string }> = {
  bedRotations: { label: "تناوب الأسرّة", hint: "جدولة تناوب السكان على الأسرّة وتنفيذها" },
  auditLog: { label: "سجل العمليات", hint: "تسجيل كل إجراء إداري في النظام" },
  notifications: { label: "الإشعارات", hint: "تنبيه المستخدمين عند تغيّر مراحل الطلبات" },
  bulkImport: { label: "الاستيراد المجمّع", hint: "استيراد السكان من ملفات CSV" },
  contractorPortal: { label: "بوابة المتعهد", hint: "تمكين حسابات المتعهدين من متابعة عمالهم" },
};

type Draft = {
  orgName: string;
  orgSubtitle: string;
  buildingLabel: string;
  defaultPageSize: string;
  lowVacancyThreshold: string;
  minWorkerAge: string;
  notifyOnRequestStage: boolean;
  notifyOnLowVacancy: boolean;
  requireEmployeeCode: boolean;
  features: Record<string, boolean>;
};

function toDraft(settings?: Settings | null): Draft {
  return {
    orgName: settings?.orgName || "",
    orgSubtitle: settings?.orgSubtitle || "",
    buildingLabel: settings?.buildingLabel || "مبنى",
    defaultPageSize: String(settings?.defaultPageSize ?? 50),
    lowVacancyThreshold: String(settings?.lowVacancyThreshold ?? 5),
    minWorkerAge: String(settings?.minWorkerAge ?? 18),
    notifyOnRequestStage: settings?.notifyOnRequestStage !== false,
    notifyOnLowVacancy: settings?.notifyOnLowVacancy !== false,
    requireEmployeeCode: settings?.requireEmployeeCode !== false,
    features: { ...(settings?.features || {}) },
  };
}

export default function SettingsPage() {
  const { data, user, offline, online, syncedAt, reload, logout } = useApp();
  const [draft, setDraft] = useState<Draft>(() => toDraft(data?.settings));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [serverUrl, setServerUrl] = useState("");

  const canManage = can(user, "admin.settings");
  const readOnly = offline || !canManage;

  useEffect(() => {
    setDraft(toDraft(data?.settings));
    setDirty(false);
  }, [data?.settings]);

  useEffect(() => {
    setServerUrl(getConfig().server_url || "");
  }, []);

  const features = useMemo(() => {
    const known = Object.keys(FEATURE_LABELS);
    const extras = Object.keys(draft.features).filter((key) => !known.includes(key));
    return [...known, ...extras];
  }, [draft.features]);

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setNotice("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await saveSettings({
        orgName: draft.orgName.trim(),
        orgSubtitle: draft.orgSubtitle.trim(),
        buildingLabel: draft.buildingLabel.trim() || "مبنى",
        defaultPageSize: Math.max(1, Number(draft.defaultPageSize) || 50),
        lowVacancyThreshold: Math.max(1, Number(draft.lowVacancyThreshold) || 5),
        minWorkerAge: Math.max(1, Number(draft.minWorkerAge) || 18),
        notifyOnRequestStage: draft.notifyOnRequestStage,
        notifyOnLowVacancy: draft.notifyOnLowVacancy,
        requireEmployeeCode: draft.requireEmployeeCode,
        features: draft.features,
      });
      await reload();
      setDirty(false);
      setNotice("تم حفظ الإعدادات وتطبيقها على النظام");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ الإعدادات");
    } finally {
      setBusy(false);
    }
  }

  async function logoutEverywhere() {
    if (!window.confirm("تسجيل الخروج من كل الأجهزة؟ ستُنهى الجلسات الحالية والمستقبلية لهذا الحساب.")) return;
    setBusy(true);
    try {
      await logoutAllDevices();
    } catch {
      /* سيتم تسجيل الخروج محلياً في كل الأحوال */
    } finally {
      setBusy(false);
      logout();
    }
  }

  function clearCache() {
    if (!window.confirm("مسح النسخة المحفوظة للاستخدام دون إنترنت؟ ستحتاج للاتصال بالخادم لتحميل البيانات لاحقاً.")) return;
    clearCachedSnapshot();
    setNotice("تم مسح النسخة المحلية — أعد التحميل للحصول على بيانات جديدة");
  }

  function saveServerUrl() {
    const value = normalizeBaseUrl(serverUrl);
    saveConfig({ ...getConfig(), server_url: value });
    setServerUrl(value);
    setError("");
    setNotice(
      value
        ? "تم حفظ رابط الخادم على هذا الجهاز — يلزم إعادة تسجيل الدخول لتطبيقه."
        : "تم مسح رابط الخادم — سيُستخدم أصل الصفحة الحالي.",
    );
    if (window.confirm("لتطبيق رابط الخادم الجديد يجب إعادة تسجيل الدخول. هل تريد الخروج الآن؟")) {
      logout();
    }
  }

  if (!data) return <Loader label="جارٍ تحميل الإعدادات..." />;

  return (
    <>
      <PageHead
        eyebrow="الإعدادات"
        title="إعدادات النظام والملف الشخصي"
        subtitle={`${data.settings?.orgName || "نظام إدارة السكن"} · ${formatNumber(data.meta?.counts?.users || 0)} مستخدم`}
        actions={
          <div className="head-actions">
            <button type="button" className="secondary-btn" onClick={() => reload()} disabled={busy}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canManage && (
              <button type="button" className="primary-btn" onClick={save} disabled={busy || !dirty || offline}>
                <Save size={16} /> {busy ? "جارٍ الحفظ..." : "حفظ التغييرات"}
              </button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {!canManage && <Alert tone="info">يمكنك استعراض الإعدادات فقط — التعديل يتطلب صلاحية إدارة الإعدادات.</Alert>}
      {offline && <Alert tone="warning">وضع دون إنترنت: التعديلات معطلة حتى يعود الاتصال.</Alert>}

      <div className="settings-layout">
        <div className="settings-main">
          <section className="form-panel">
            <SectionTitle title="بيانات المنشأة" hint="تظهر في الترويسة والتقارير" />
            <div className="form-grid">
              <Field label="اسم المنشأة">
                <TextInput value={draft.orgName} disabled={readOnly} onChange={(event) => update({ orgName: event.target.value })} />
              </Field>
              <Field label="الوصف المختصر">
                <TextInput value={draft.orgSubtitle} disabled={readOnly} onChange={(event) => update({ orgSubtitle: event.target.value })} />
              </Field>
              <Field label="تسمية المبنى" hint="مثال: مبنى، مجمع، سكن">
                <TextInput value={draft.buildingLabel} disabled={readOnly} onChange={(event) => update({ buildingLabel: event.target.value })} />
              </Field>
            </div>
          </section>

          <section className="form-panel">
            <SectionTitle title="الإعدادات التشغيلية" hint="القيم الافتراضية للنماذج والتقارير" />
            <div className="form-grid">
              <Field label="حجم الصفحة الافتراضي" hint="عدد السجلات في الجداول">
                <TextInput type="number" min={1} value={draft.defaultPageSize} disabled={readOnly} onChange={(event) => update({ defaultPageSize: event.target.value })} />
              </Field>
              <Field label="حد انخفاض الشواغر" hint="تنبيه عند بقاء أسرّة شاغرة أقل من هذا الرقم">
                <TextInput type="number" min={1} value={draft.lowVacancyThreshold} disabled={readOnly} onChange={(event) => update({ lowVacancyThreshold: event.target.value })} />
              </Field>
              <Field label="أقل عمر للعامل" hint="يُطبّق على طلبات إضافة العمال">
                <TextInput type="number" min={1} value={draft.minWorkerAge} disabled={readOnly} onChange={(event) => update({ minWorkerAge: event.target.value })} />
              </Field>
            </div>
          </section>

          <section className="form-panel">
            <SectionTitle title="التنبيهات والسياسات" hint="تفعيل أو تعطيل قواعد العمل" />
            <div className="settings-toggles">
              <label className="toggle-row">
                <span>
                  <strong>إشعار تغيّر مرحلة الطلب</strong>
                  <small>إرسال إشعار للمستخدمين عند انتقال طلب متعهد إلى مرحلة جديدة</small>
                </span>
                <input type="checkbox" className="switch" checked={draft.notifyOnRequestStage} disabled={readOnly} onChange={(event) => update({ notifyOnRequestStage: event.target.checked })} />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>إشعار انخفاض الشواغر</strong>
                  <small>تنبيه إداري عند اقتراب امتلاء السكن</small>
                </span>
                <input type="checkbox" className="switch" checked={draft.notifyOnLowVacancy} disabled={readOnly} onChange={(event) => update({ notifyOnLowVacancy: event.target.checked })} />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>إلزام الرقم الوظيفي</strong>
                  <small>لا يمكن اعتماد عامل جديد بدون رقم وظيفي</small>
                </span>
                <input type="checkbox" className="switch" checked={draft.requireEmployeeCode} disabled={readOnly} onChange={(event) => update({ requireEmployeeCode: event.target.checked })} />
              </label>
            </div>
          </section>

          <section className="form-panel">
            <SectionTitle title="خصائص النظام" hint="تفعيل أو تعطيل وحدات متقدمة" />
            <div className="settings-toggles">
              {features.map((key) => {
                const meta = FEATURE_LABELS[key] || { label: key, hint: "خاصية مخصصة" };
                const value = draft.features[key] !== false;
                return (
                  <label className="toggle-row" key={key}>
                    <span>
                      <strong>{meta.label}</strong>
                      <small>{meta.hint}</small>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={value}
                      disabled={readOnly}
                      onChange={(event) => update({ features: { ...draft.features, [key]: event.target.checked } })}
                    />
                  </label>
                );
              })}
            </div>
          </section>

          {canManage && (
            <div className="settings-save-bar">
              <span>{dirty ? "لديك تغييرات غير محفوظة" : "كل التغييرات محفوظة"}</span>
              <div className="row-actions">
                <button type="button" className="secondary-btn" onClick={() => { setDraft(toDraft(data.settings)); setDirty(false); }} disabled={busy || !dirty}>
                  تراجع
                </button>
                <button type="button" className="primary-btn" onClick={save} disabled={busy || !dirty || offline}>
                  <Save size={16} /> حفظ
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="settings-side">
          <section className="form-panel">
            <SectionTitle title="الملف الشخصي" />
            <div className="profile-block">
              <div className="avatar avatar-lg">{(user?.name || "؟").slice(0, 1)}</div>
              <div>
                <strong>{user?.name}</strong>
                <small>{user?.username}</small>
                <Badge tone="info">{roleLabel(user?.roleId, user?.roleName)}</Badge>
              </div>
            </div>
            <InfoGrid
              items={[
                { label: "الجوال", value: user?.phone || "—" },
                { label: "المتعهد", value: user?.contractorName || "—" },
                { label: "آخر دخول", value: user?.lastLoginAt ? timeAgo(user.lastLoginAt) : "—" },
                { label: "الصلاحيات", value: formatNumber((user?.permissions || []).length) },
              ]}
            />
            <div className="stack">
              <a className="secondary-btn" href={routePath("/change-password")}>
                <KeyRound size={16} /> تغيير كلمة المرور
              </a>
              <button type="button" className="secondary-btn" onClick={logoutEverywhere} disabled={busy || offline}>
                <LogOut size={16} /> خروج من كل الأجهزة
              </button>
            </div>
          </section>

          <section className="form-panel">
            <SectionTitle title="حالة النظام" />
            <ul className="status-list">
              <li>
                <Wifi size={16} />
                <span>الاتصال</span>
                <Badge tone={online && !offline ? "good" : "bad"}>{online && !offline ? "متصل" : "دون إنترنت"}</Badge>
              </li>
              <li>
                <Database size={16} />
                <span>المخزن</span>
                <Badge tone="info">{data.meta?.mode === "postgres" ? "PostgreSQL" : "JSON محلي"}</Badge>
              </li>
              <li>
                <ShieldCheck size={16} />
                <span>الإصدار</span>
                <Badge tone="muted">v{data.meta?.version || "2.0.0"}</Badge>
              </li>
              <li>
                <RefreshCw size={16} />
                <span>آخر مزامنة</span>
                <Badge tone="muted">{syncedAt ? timeAgo(syncedAt) : "—"}</Badge>
              </li>
              <li>
                <HardDrive size={16} />
                <span>سكان مسجّلون</span>
                <Badge tone="muted">{formatNumber(data.meta?.counts?.residents || 0)}</Badge>
              </li>
            </ul>
            <p className="muted small-text">وقت الخادم: {formatDateTime(data.meta?.serverTime)}</p>
          </section>

          <section className="form-panel">
            <SectionTitle title="التطبيق والعمل دون إنترنت" />
            <p className="muted small-text">
              يحفظ التطبيق نسخة محلية للعرض دون إنترنت، ويدعم الدخول برمز PIN على الأجهزة. التعديلات تتطلب الاتصال بالخادم.
            </p>
            <div className="stack">
              <label className="field">
                <span>رابط الخادم (API)</span>
                <div className="input-wrap">
                  <Server size={19} />
                  <input
                    value={serverUrl}
                    onChange={(event) => setServerUrl(event.target.value)}
                    inputMode="url"
                    placeholder="https://housing-system-api.onrender.com"
                  />
                </div>
                <small className="muted">
                  اتركه فارغاً لاستخدام أصل الصفحة. على أندرويد أدخل الرابط كاملاً مثل
                  <code> http://192.168.1.10:8000</code>
                </small>
              </label>
              <button type="button" className="secondary-btn" onClick={saveServerUrl}>
                <Save size={16} /> حفظ رابط الخادم
              </button>
              <a className="secondary-btn" href={routePath("/about")}>
                <Smartphone size={16} /> دليل التطبيق
              </a>
              <button type="button" className="danger-btn" onClick={clearCache} disabled={busy}>
                <WifiOff size={16} /> مسح النسخة المحلية
              </button>
            </div>
          </section>

          <section className="form-panel">
            <SectionTitle title="اختصارات" />
            <div className="stack">
              <a className="secondary-btn" href={routePath("/admin")}>
                <UserRound size={16} /> إدارة المستخدمين
              </a>
              <a className="secondary-btn" href={routePath("/reports")}>
                <Settings2 size={16} /> مركز التقارير
              </a>
              <a className="secondary-btn" href={routePath("/housing")}>
                <Building2 size={16} /> إدارة السكن
              </a>
            </div>
          </section>

          {!data.settings && <EmptyState title="لا توجد إعدادات محفوظة" hint="ستُستخدم القيم الافتراضية" />}
          {data.settings && (
            <div className="settings-ok">
              <CheckCircle2 size={16} /> الإعدادات مطبّقة على {formatNumber(data.meta?.counts?.users || 0)} مستخدم
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
