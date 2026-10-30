"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BedDouble,
  Building2,
  CheckCircle2,
  ClipboardList,
  DoorOpen,
  FilePlus2,
  Home,
  Plus,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { createContractorRequest, getContractorPortal } from "@/lib/api";
import { formatDate, formatDateTime, formatNumber, formatPercent, stageLabel, statusTone, timeAgo } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { ContractorPortal, ContractorRequest } from "@/lib/types";
import {
  Alert,
  Badge,
  EmptyState,
  ErrorNote,
  Field,
  InfoGrid,
  Loader,
  Modal,
  PageHead,
  Progress,
  Select,
  StatCard,
  Tabs,
  TextArea,
  TextInput,
  occupancyTone,
} from "@/components/ui";

type TabId = "workers" | "registered" | "requests";

const EMPTY_REQUEST = {
  requestType: "new_worker",
  workerName: "",
  jobTitle: "",
  workerCardNumber: "",
  workerBirthDate: "",
  workerBirthPlace: "",
  reason: "",
};

export default function ContractorPortalPage() {
  const { data, user, offline, reload } = useApp();
  const [portal, setPortal] = useState<ContractorPortal | null>(data?.contractorPortal || null);
  const [tab, setTab] = useState<TabId>("workers");
  const [loading, setLoading] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_REQUEST });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<ContractorRequest | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const canRequest = can(user, "contractor.portal") || can(user, "contractors.manage");

  const load = useCallback(async () => {
    if (offline) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || user?.contractorId || data?.contractorPortal?.contractor.id;
    if (!id) {
      setPortal(data?.contractorPortal || null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await getContractorPortal(id);
      setPortal(result);
    } catch (err) {
      if (!data?.contractorPortal) setError(err instanceof Error ? err.message : "تعذر تحميل بيانات المتعهد");
      else setPortal(data.contractorPortal);
    } finally {
      setLoading(false);
    }
  }, [offline, user?.contractorId, data?.contractorPortal]);

  useEffect(() => {
    if (!offline) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = portal?.contractor.stats;

  const workers = useMemo(() => portal?.workers || [], [portal]);
  const registered = useMemo(() => portal?.registeredWorkers || [], [portal]);
  const requests = useMemo(
    () => (portal?.requests || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [portal],
  );

  const pending = requests.filter((request) => request.stage !== "done" && request.stage !== "rejected");

  function notify(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 5000);
  }

  async function submitRequest() {
    if (!portal) return;
    if (!draft.workerName.trim()) {
      setFormError("اسم العامل مطلوب");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await createContractorRequest({
        contractorId: portal.contractor.id,
        requestType: draft.requestType,
        workerName: draft.workerName.trim(),
        jobTitle: draft.jobTitle.trim() || undefined,
        workerCardNumber: draft.workerCardNumber.trim() || undefined,
        workerBirthDate: draft.workerBirthDate || undefined,
        workerBirthPlace: draft.workerBirthPlace.trim() || undefined,
        reason: draft.reason.trim() || undefined,
      });
      setRequestOpen(false);
      setDraft({ ...EMPTY_REQUEST });
      await reload();
      await load();
      notify("تم إرسال الطلب للاعتماد");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر إرسال الطلب");
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <Loader label="جارٍ تحميل بوابة المتعهد..." />;

  if (!portal) {
    return (
      <>
        <PageHead eyebrow="بوابة المتعهد" title="بوابة المتعهد" subtitle="متابعة العمالة والطلبات" />
        {error && <ErrorNote message={error} />}
        <EmptyState
          title="لا يوجد متعهد مرتبط بهذا الحساب"
          hint="تواصل مع مدير النظام لربط حسابك بمتعهد، أو افتح البوابة من صفحة المتعهدين"
        />
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="بوابة المتعهد"
        title={portal.contractor.name}
        subtitle={`${portal.contractor.department ? `${portal.contractor.department} · ` : ""}${formatNumber(stats?.workerCount || 0)} عامل · ${formatNumber(stats?.freeQuota || 0)} شاغر تعاقدي · ${formatNumber(pending.length)} طلب معلّق`}
        actions={
          <div className="head-actions">
            <button type="button" className="secondary-btn" onClick={() => load()} disabled={loading || offline}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canRequest && (
              <button type="button" className="primary-btn" onClick={() => { setDraft({ ...EMPTY_REQUEST }); setFormError(""); setRequestOpen(true); }} disabled={offline}>
                <Plus size={16} /> طلب جديد
              </button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {offline && <Alert tone="warning">وضع دون إنترنت: عرض فقط للبيانات المحفوظة.</Alert>}

      <div className="stats-grid stats-grid-4">
        <StatCard icon={UsersRound} label="عمال المتعهد" value={formatNumber(stats?.workerCount || workers.length)} hint={`${formatNumber(portal.contractor.bedQuota || 0)} سعة`} />
        <StatCard icon={BedDouble} label="الشاغر التعاقدي" value={formatNumber(stats?.freeQuota || 0)} tone={(stats?.freeQuota || 0) > 0 ? "success" : "danger"} />
        <StatCard icon={Building2} label="الإشغال" value={formatPercent(stats?.occupancyPercent || 0)} hint={`${formatNumber(stats?.freePhysicalBeds || 0)} سرير شاغر فعلي`} tone={occupancyTone(stats?.occupancyPercent || 0)} />
        <StatCard icon={ClipboardList} label="طلبات معلّقة" value={formatNumber(pending.length)} hint={`${formatNumber(requests.length)} إجمالي الطلبات`} tone="warn" />
      </div>

      <section className="form-panel quota-panel">
        <div>
          <span>استهلاك السعة</span>
          <strong>{formatNumber(stats?.workerCount || 0)} / {formatNumber(stats?.capacity || 0)}</strong>
        </div>
        <Progress value={stats?.occupancyPercent || 0} tone={occupancyTone(stats?.occupancyPercent || 0)} />
        <small>المباني: {(portal.contractor.buildingNames || []).join("، ") || "لم تُحدد"}</small>
      </section>

      <Tabs
        tabs={[
          { id: "workers", label: "العمال المسكّنون", count: workers.length },
          { id: "registered", label: "سجل العمال", count: registered.length },
          { id: "requests", label: "الطلبات", count: requests.length },
        ]}
        active={tab}
        onChange={(id) => setTab(id)}
      />

      {tab === "workers" && (
        <section className="table-card">
          {workers.length ? (
            <div className="table-scroll">
              <table className="residents-table">
                <thead>
                  <tr><th>العامل</th><th>المسمى</th><th>الموقع</th><th>الحالة</th><th>البطاقة</th></tr>
                </thead>
                <tbody>
                  {workers.map((worker) => (
                    <tr key={worker.id}>
                      <td><strong>{worker.name}</strong><small className="block-note">{worker.company}</small></td>
                      <td>{worker.jobTitle || "—"}</td>
                      <td>{worker.location || "غير مسكن"}</td>
                      <td><Badge tone={statusTone(worker.attendanceStatus || worker.baseStatus)}>{worker.attendanceStatus || worker.baseStatus || "—"}</Badge></td>
                      <td>{worker.cardNumber || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="لا يوجد عمال مسكّنون" hint="قدّم طلب إضافة عامل لبدء التسكين" />
          )}
        </section>
      )}

      {tab === "registered" && (
        <section className="table-card">
          {registered.length ? (
            <div className="table-scroll">
              <table className="residents-table">
                <thead>
                  <tr><th>الاسم</th><th>المسمى</th><th>الحالة</th><th>البوابة</th><th>السرير</th></tr>
                </thead>
                <tbody>
                  {registered.map((worker) => {
                    const located = workers.find((item) => item.bedId === worker.bedId);
                    return (
                      <tr key={worker.id}>
                        <td><strong>{worker.fullName}</strong><small className="block-note">{worker.birthPlace || "—"}</small></td>
                        <td>{worker.jobTitle || "—"}</td>
                        <td><Badge tone={statusTone(worker.status)}>
{worker.status === "assigned" ? "مسكّن" : worker.status === "removed" ? "مستبعد" : worker.status || "—"}</Badge></td>
                        <td><Badge tone={worker.gateStatus === "approved" ? "good" : "muted"}>{worker.gateStatus === "approved" ? "معتمد" : worker.gateStatus || "—"}</Badge></td>
                        <td>{located?.location || (worker.bedId ? "مسكّن" : "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="لا يوجد سجل عمال" hint="يُسجّل العمال تلقائياً عند اعتماد طلبات الإضافة" />
          )}
        </section>
      )}

      {tab === "requests" && (
        <section className="table-card">
          {requests.length ? (
            <div className="table-scroll">
              <table className="residents-table">
                <thead>
                  <tr><th>العامل</th><th>النوع</th><th>المرحلة</th><th>السرير</th><th>أنشئ</th><th>إجراءات</th></tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td><strong>{request.workerName}</strong><small className="block-note">{request.workerCardNumber || request.jobTitle || "—"}</small></td>
                      <td><Badge tone={request.requestType === "new_worker" ? "info" : "warn"}>{request.typeLabel || (request.requestType === "new_worker" ? "إضافة عامل" : "استبعاد عامل")}</Badge></td>
                      <td><Badge tone={statusTone(request.stage)} dot>{request.stageLabel || stageLabel(request.stage)}</Badge></td>
                      <td>{request.bedLabel ? `${request.bedLabel}${request.roomName ? ` · ${request.roomName}` : ""}` : "—"}</td>
                      <td>{timeAgo(request.createdAt)}</td>
                      <td><button type="button" className="secondary-btn small-btn" onClick={() => setDetail(request)}>تفاصيل</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="لا توجد طلبات"
              hint={canRequest ? "قدّم طلب إضافة أو استبعاد عامل" : undefined}
              action={canRequest && !offline ? <button type="button" className="primary-btn" onClick={() => setRequestOpen(true)}><FilePlus2 size={16} /> طلب جديد</button> : undefined}
            />
          )}
        </section>
      )}

      {/* ------------------------------- طلب جديد ------------------------------- */}
      <Modal
        open={requestOpen}
        title="طلب جديد"
        subtitle={portal.contractor.name}
        onClose={() => setRequestOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setRequestOpen(false)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={submitRequest} disabled={saving || offline}>
              <FilePlus2 size={16} /> {saving ? "جارٍ الإرسال..." : "إرسال الطلب"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="نوع الطلب" required>
            <Select
              value={draft.requestType}
              onChange={(event) => setDraft({ ...draft, requestType: event.target.value, workerName: "", workerCardNumber: "", workerBirthDate: "", workerBirthPlace: "" })}
              options={[
                { value: "new_worker", label: "إضافة عامل" },
                { value: "remove_worker", label: "استبعاد عامل" },
              ]}
            />
          </Field>
          {draft.requestType === "remove_worker" && (
            <Field label="اختر العامل">
              <Select
                value=""
                onChange={(event) => {
                  const worker = workers.find((item) => item.id === event.target.value);
                  if (!worker) return;
                  setDraft({
                    ...draft,
                    workerName: worker.name,
                    workerCardNumber: worker.cardNumber || "",
                    jobTitle: worker.jobTitle || "",
                  });
                }}
                placeholder="اختر من العمال المسكّنين..."
                options={workers.map((worker) => ({ value: worker.id, label: worker.name }))}
              />
            </Field>
          )}
          <Field label="اسم العامل" required>
            <TextInput value={draft.workerName} onChange={(event) => setDraft({ ...draft, workerName: event.target.value })} />
          </Field>
          <Field label="المسمى الوظيفي">
            <TextInput value={draft.jobTitle} onChange={(event) => setDraft({ ...draft, jobTitle: event.target.value })} />
          </Field>
          <Field label="رقم البطاقة" required={draft.requestType === "new_worker"}>
            <TextInput value={draft.workerCardNumber} onChange={(event) => setDraft({ ...draft, workerCardNumber: event.target.value })} />
          </Field>
          <Field label="تاريخ الميلاد" required={draft.requestType === "new_worker"}>
            <TextInput type="date" value={draft.workerBirthDate} onChange={(event) => setDraft({ ...draft, workerBirthDate: event.target.value })} />
          </Field>
          <Field label="مكان الميلاد" required={draft.requestType === "new_worker"}>
            <TextInput value={draft.workerBirthPlace} onChange={(event) => setDraft({ ...draft, workerBirthPlace: event.target.value })} />
          </Field>
          <Field label="سبب الطلب / ملاحظات" className="full">
            <TextArea rows={3} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
          </Field>
        </div>
        {(stats?.freeQuota || 0) <= 0 && draft.requestType === "new_worker" && (
          <Alert tone="warning">لا يوجد شاغر تعاقدي متبقٍ — لن يُقبل طلب إضافة عامل جديد حتى تتوفر سعة.</Alert>
        )}
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>

      {/* -------------------------------- التفاصيل ------------------------------- */}
      <Modal open={!!detail} title="تفاصيل الطلب" subtitle={detail ? detail.workerName : undefined} onClose={() => setDetail(null)}>
        {detail && (
          <div className="stack-lg">
            <InfoGrid
              items={[
                { label: "رقم الطلب", value: detail.id },
                { label: "النوع", value: detail.typeLabel || (detail.requestType === "new_worker" ? "إضافة عامل" : "استبعاد عامل") },
                { label: "المرحلة", value: <Badge tone={statusTone(detail.stage)}>{detail.stageLabel || stageLabel(detail.stage)}</Badge> },
                { label: "رقم البطاقة", value: detail.workerCardNumber || "—" },
                { label: "كود الموظف", value: detail.employeeCode ? detail.employeeCode : "يُدخله مراقب الزوار عند الاعتماد" },
                { label: "تاريخ الميلاد", value: detail.workerBirthDate ? formatDate(detail.workerBirthDate) : "—" },
                { label: "مكان الميلاد", value: detail.workerBirthPlace || "—" },
                { label: "السكن المحدد", value: detail.bedLabel ? `${detail.bedLabel}${detail.roomName ? ` · ${detail.roomName}` : ""}` : "يظهر بعد اكتمال الاعتمادات" },
                { label: "تاريخ الإنشاء", value: formatDateTime(detail.createdAt) },
                { label: "آخر مراجعة", value: detail.reviewedAt ? formatDateTime(detail.reviewedAt) : "—" },
              ]}
            />
            {detail.reviewNotes && <Alert tone={detail.stage === "rejected" ? "danger" : "info"}>{detail.reviewNotes}</Alert>}
            <div>
              <h3 className="sub-title">مسار الطلب</h3>
              <div className="stage-stepper">
                {(() => {
                  const order = detail.requestType === "new_worker"
                    ? ["department", "security", "visitor", "housing", "done"]
                    : ["department", "security", "visitor", "done"];
                  const currentIndex = detail.stage === "rejected" ? -1 : order.indexOf(detail.stage);
                  return order.map((step) => {
                    const stepIndex = order.indexOf(step);
                    const active = detail.stage === step;
                    const passed = detail.stage === "done" ? true : currentIndex > stepIndex;
                    return (
                      <div key={step} className={`stage-step ${active ? "active" : ""} ${passed ? "passed" : ""} ${detail.stage === "rejected" ? "rejected" : ""}`}>
                        <span>{passed ? <CheckCircle2 size={15} /> : step === "housing" ? <Home size={15} /> : step === "security" ? <ShieldCheck size={15} /> : step === "done" ? <CheckCircle2 size={15} /> : <DoorOpen size={15} />}</span>
                        <small>{stageLabel(step)}</small>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
            {detail.history?.length ? (
              <ul className="timeline">
                {detail.history.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <span className={`timeline-dot ${entry.action === "rejected" ? "bad" : ""}`} />
                    <div>
                      <strong>{entry.by || "النظام"}</strong>
                      <p>{entry.action === "approved" ? "اعتماد" : entry.action === "rejected" ? "رفض" : "إرسال"} · {stageLabel(entry.stage)}</p>
                      {entry.notes && <p className="muted">{entry.notes}</p>}
                      <small>{formatDateTime(entry.at)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
