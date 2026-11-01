"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  ClipboardList,
  Download,
  ExternalLink,
  Handshake,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unlink,
  UsersRound,
  X,
} from "lucide-react";
import {
  createContractor,
  deleteContractor,
  fetchTextFile,
  linkContractorWorkers,
  reportCsvPath,
  unlinkContractorWorker,
  updateContractor,
} from "@/lib/api";
import { downloadCsv } from "@/lib/export";
import { formatNumber, formatPercent, statusTone, todayISO } from "@/lib/format";
import { routePath } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { Contractor, Resident } from "@/lib/types";
import {
  Alert,
  Badge,
  EmptyState,
  ErrorNote,
  Field,
  InfoGrid,
  Loader,
  Modal,
  MultiSelect,
  PageHead,
  Progress,
  SearchInput,
  Select,
  StatCard,
  TextArea,
  TextInput,
  occupancyTone,
} from "@/components/ui";

const CONTRACTOR_TYPES = [
  { value: "general", label: "عام" },
  { value: "catering", label: "إعاشة" },
  { value: "cleaning", label: "نظافة" },
  { value: "labor", label: "عمالة" },
  { value: "security", label: "حراسات" },
  { value: "maintenance", label: "صيانة" },
  { value: "other", label: "أخرى" },
];

const CONTRACTOR_DEPARTMENTS = [
  "إدارة الشؤون",
  "إدارة التخطيط",
  "إدارة التعبئة",
  "إدارة الصيانة",
];

const EMPTY_CONTRACTOR = {
  name: "",
  contractorType: "general",
  department: "",
  contactPhone: "",
  contactEmail: "",
  status: "active",
  bedQuota: "0",
  notes: "",
  buildingIds: [] as string[],
};

function typeLabel(value?: string): string {
  return CONTRACTOR_TYPES.find((item) => item.value === value)?.label || value || "عام";
}

export default function ContractorsPage() {
  const { data, user, offline, reload } = useApp();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<"usage" | "name" | "workers">("usage");
  const [busy, setBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contractor | null>(null);
  const [draft, setDraft] = useState({ ...EMPTY_CONTRACTOR });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Contractor | null>(null);
  const [linkTarget, setLinkTarget] = useState<Contractor | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkSelected, setLinkSelected] = useState<string[]>([]);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const canManage = can(user, "contractors.manage");
  const canExport = can(user, "reports.export");
  const readOnly = offline || !canManage;

  const workersOf = useMemo(() => {
    return (contractor: Contractor): Resident[] => {
      const direct = (data?.residents || []).filter((resident) => resident.contractorId === contractor.id);
      if (direct.length) return direct;
      const name = contractor.name.trim();
      if (!name) return [];
      return (data?.residents || []).filter((resident) => (resident.company || "").trim() === name);
    };
  }, [data]);

  const contractors = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (data?.contractors || []).filter((contractor) => {
      if (statusFilter && (contractor.status || "active") !== statusFilter) return false;
      if (!needle) return true;
      return [contractor.name, contractor.contactPhone, contractor.contactEmail, ...(contractor.buildingNames || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    return rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ar");
      if (sort === "workers") return (b.stats?.workerCount || 0) - (a.stats?.workerCount || 0);
      return (b.stats?.occupancyPercent || 0) - (a.stats?.occupancyPercent || 0);
    });
  }, [data, query, statusFilter, sort]);

  const totals = useMemo(() => {
    const rows = data?.contractors || [];
    return {
      contractors: rows.length,
      active: rows.filter((contractor) => (contractor.status || "active") === "active").length,
      capacity: rows.reduce((sum, contractor) => sum + (contractor.stats?.capacity || contractor.bedQuota || 0), 0),
      workers: rows.reduce((sum, contractor) => sum + (contractor.stats?.workerCount || 0), 0),
      free: rows.reduce((sum, contractor) => sum + (contractor.stats?.freeQuota || 0), 0),
      pending: rows.reduce((sum, contractor) => sum + (contractor.stats?.pendingRequests || 0), 0),
    };
  }, [data]);

  const linkCandidates = useMemo(() => {
    if (!linkTarget) return [];
    const needle = linkQuery.trim().toLowerCase();
    return (data?.residents || [])
      .filter((resident) => {
        if (resident.contractorId === linkTarget.id) return false;
        if (!needle) return true;
        return [resident.name, resident.employeeCode, resident.company, resident.cardNumber]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"))
      .slice(0, 120);
  }, [data, linkTarget, linkQuery]);

  function notify(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 5000);
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "تعذر تنفيذ الإجراء");
  }

  function openCreate() {
    setEditing(null);
    setDraft({ ...EMPTY_CONTRACTOR });
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(contractor: Contractor) {
    setEditing(contractor);
    setDraft({
      name: contractor.name,
      contractorType: contractor.contractorType || "general",
      department: contractor.department || "",
      contactPhone: contractor.contactPhone || "",
      contactEmail: contractor.contactEmail || "",
      status: contractor.status || "active",
      bedQuota: String(contractor.bedQuota ?? 0),
      notes: contractor.notes || "",
      buildingIds: contractor.buildingIds || [],
    });
    setFormError("");
    setFormOpen(true);
    setDetail(null);
  }

  async function saveContractor() {
    if (!draft.name.trim()) {
      setFormError("اسم المتعهد مطلوب");
      return;
    }
    if (!draft.buildingIds.length) {
      setFormError("اختر مبنى واحداً على الأقل");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: draft.name.trim(),
        contractorType: draft.contractorType,
        department: draft.department,
        contactPhone: draft.contactPhone.trim(),
        contactEmail: draft.contactEmail.trim(),
        status: draft.status,
        bedQuota: Number(draft.bedQuota) || 0,
        notes: draft.notes.trim(),
        buildingIds: draft.buildingIds,
      };
      if (editing) await updateContractor(editing.id, payload);
      else await createContractor(payload);
      setFormOpen(false);
      await reload();
      notify(editing ? "تم تحديث بيانات المتعهد" : "تمت إضافة المتعهد");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر حفظ المتعهد");
    } finally {
      setSaving(false);
    }
  }

  async function removeContractor(contractor: Contractor) {
    if (!window.confirm(`حذف المتعهد ${contractor.name}؟ لا يمكن التراجع.`)) return;
    setBusy(true);
    try {
      await deleteContractor(contractor.id);
      setDetail(null);
      await reload();
      notify("تم حذف المتعهد");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function unlinkWorker(contractor: Contractor, resident: Resident) {
    if (!window.confirm(`فصل العامل ${resident.name} عن المتعهد ${contractor.name}؟`)) return;
    setBusy(true);
    try {
      await unlinkContractorWorker(contractor.id, resident.id);
      await reload();
      notify("تم فصل العامل عن المتعهد");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveLinks() {
    if (!linkTarget) return;
    if (!linkSelected.length) return;
    setBusy(true);
    try {
      const result = await linkContractorWorkers(linkTarget.id, linkSelected);
      setLinkTarget(null);
      setLinkSelected([]);
      setLinkQuery("");
      await reload();
      notify(`تم ربط ${formatNumber(result.linked)} عامل بالمتعهد`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    try {
      const file = await fetchTextFile(reportCsvPath("contractors"));
      downloadCsv(`contractors-${todayISO()}.csv`, file.content);
      notify("تم تصدير بيانات المتعهدين");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Loader label="جارٍ تحميل المتعهدين..." />;

  const buildingOptions = (data.buildings || []).map((building) => ({ value: building.id, label: building.name }));
  const detailWorkers = detail ? workersOf(detail) : [];

  return (
    <>
      <PageHead
        eyebrow="المتعهدون"
        title="المتعهدون وسعة السكن"
        subtitle={`${formatNumber(totals.contractors)} متعهد · ${formatNumber(totals.workers)} عامل · ${formatNumber(totals.capacity)} سعة سريرية`}
        actions={
          <div className="head-actions">
            {canExport && (
              <button type="button" className="secondary-btn" onClick={exportCsv} disabled={busy || offline}>
                <Download size={16} /> تصدير
              </button>
            )}
            <button type="button" className="secondary-btn" onClick={() => reload()} disabled={busy}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canManage && (
              <button type="button" className="primary-btn" onClick={openCreate} disabled={offline}>
                <Plus size={16} /> متعهد جديد
              </button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {offline && <Alert tone="warning">وضع دون إنترنت: عرض فقط.</Alert>}

      <div className="stats-grid stats-grid-4">
        <StatCard icon={Handshake} label="المتعهدون" value={formatNumber(totals.contractors)} hint={`${formatNumber(totals.active)} نشط`} />
        <StatCard icon={UsersRound} label="العمال المسكّنون" value={formatNumber(totals.workers)} tone="success" />
        <StatCard icon={Building2} label="السعة التعاقدية" value={formatNumber(totals.capacity)} hint={`${formatNumber(totals.free)} شاغر`} tone="info" />
        <StatCard icon={ClipboardList} label="طلبات معلّقة" value={formatNumber(totals.pending)} tone="warn" />
      </div>

      <section className="form-panel filters-panel">
        <div className="filters-row">
          <SearchInput value={query} onChange={setQuery} placeholder="بحث بالاسم أو الجوال أو المبنى..." />
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            placeholder="كل الحالات"
            options={[
              { value: "active", label: "نشط" },
              { value: "inactive", label: "موقوف" },
            ]}
          />
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as "usage" | "name" | "workers")}
            options={[
              { value: "usage", label: "ترتيب: نسبة الإشغال" },
              { value: "workers", label: "ترتيب: عدد العمال" },
              { value: "name", label: "ترتيب: الاسم" },
            ]}
          />
        </div>
        <div className="filters-foot">
          <span>النتائج: <strong>{formatNumber(contractors.length)}</strong> من {formatNumber(totals.contractors)}</span>
        </div>
      </section>

      <section className="table-card">
        {contractors.length ? (
          <div className="table-scroll">
            <table className="residents-table">
              <thead>
                <tr>
                  <th>المتعهد</th>
                  <th>النوع</th>
                  <th>الإدارة</th>
                  <th>المباني</th>
                  <th>العمال / السعة</th>
                  <th>الإشغال</th>
                  <th>الأسرّة الفعلية</th>
                  <th>معلّق</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((contractor) => {
                  const stats = contractor.stats;
                  const percent = stats?.occupancyPercent ?? 0;
                  return (
                    <tr key={contractor.id}>
                      <td>
                        <button type="button" className="link-name" onClick={() => setDetail(contractor)}>
                          <strong>{contractor.name}</strong>
                          <small>{contractor.contactPhone || contractor.contactEmail || "بدون بيانات اتصال"}</small>
                        </button>
                      </td>
                      <td>{typeLabel(contractor.contractorType)}</td>
                      <td>{contractor.department ? <Badge tone="info">{contractor.department}</Badge> : <span className="muted">—</span>}</td>
                      <td>
                        <div className="chip-row">
                          {(contractor.buildingNames || []).slice(0, 3).map((name) => (
                            <span className="mini-chip" key={name}>{name}</span>
                          ))}
                          {(contractor.buildingNames || []).length > 3 && <span className="mini-chip">+{(contractor.buildingNames || []).length - 3}</span>}
                          {!(contractor.buildingNames || []).length && <span className="muted">—</span>}
                        </div>
                      </td>
                      <td>{formatNumber(stats?.workerCount || 0)} / {formatNumber(stats?.capacity || contractor.bedQuota || 0)}</td>
                      <td>
                        <div className="inline-progress">
                          <Progress value={percent} tone={occupancyTone(percent)} />
                          <small>{formatPercent(percent)}</small>
                        </div>
                      </td>
                      <td>
                        {formatNumber(stats?.occupiedBeds || 0)} / {formatNumber(stats?.physicalBeds || 0)}
                        <small className="block-note">{formatNumber(stats?.freePhysicalBeds || 0)} شاغر فعلي</small>
                      </td>
                      <td>
                        {stats?.pendingRequests ? <Badge tone="warn">{formatNumber(stats.pendingRequests)}</Badge> : <span className="muted">—</span>}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="icon-plain" title="عرض التفاصيل" onClick={() => setDetail(contractor)}>
                            <Search size={16} />
                          </button>
                          {canManage && (
                            <>
                              <button type="button" className="icon-plain" title="تعديل" onClick={() => openEdit(contractor)} disabled={offline}>
                                <Pencil size={16} />
                              </button>
                              <button type="button" className="icon-plain danger" title="حذف" onClick={() => removeContractor(contractor)} disabled={offline || busy}>
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="لا يوجد متعهدون مطابقون"
            hint={canManage ? "أضف متعهداً وحدد المباني والسعة" : "جرّب تغيير البحث أو الحالة"}
            action={canManage && !offline ? <button type="button" className="primary-btn" onClick={openCreate}><Plus size={16} /> إضافة متعهد</button> : undefined}
          />
        )}
      </section>

      {/* ------------------------------- التفاصيل ------------------------------- */}
      <Modal open={!!detail} title="ملف المتعهد" subtitle={detail?.name} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="stack-lg">
            <InfoGrid
              items={[
                { label: "النوع", value: typeLabel(detail.contractorType) },
                { label: "الإدارة", value: detail.department || "—" },
                { label: "الحالة", value: <Badge tone={detail.status === "inactive" ? "bad" : "good"}>{detail.status === "inactive" ? "موقوف" : "نشط"}</Badge> },
                { label: "الجوال", value: detail.contactPhone || "—" },
                { label: "البريد", value: detail.contactEmail || "—" },
                { label: "السعة التعاقدية", value: formatNumber(detail.stats?.capacity || detail.bedQuota || 0) },
                { label: "العمال", value: formatNumber(detail.stats?.workerCount || 0) },
                { label: "الشاغر التعاقدي", value: formatNumber(detail.stats?.freeQuota || 0) },
                { label: "نسبة الإشغال", value: formatPercent(detail.stats?.occupancyPercent || 0) },
                { label: "الأسرّة الفعلية", value: `${formatNumber(detail.stats?.occupiedBeds || 0)} / ${formatNumber(detail.stats?.physicalBeds || 0)}` },
                { label: "الأسرّة الشاغرة فعلياً", value: formatNumber(detail.stats?.freePhysicalBeds || 0) },
                { label: "المباني", value: (detail.buildingNames || []).join("، ") || "—" },
                { label: "طلبات معلّقة", value: formatNumber(detail.stats?.pendingRequests || 0) },
              ]}
            />
            {detail.notes && <Alert tone="info">{detail.notes}</Alert>}

            <div className="quota-panel">
              <div>
                <span>استهلاك السعة التعاقدية</span>
                <strong>{formatPercent(detail.stats?.occupancyPercent || 0)}</strong>
              </div>
              <Progress value={detail.stats?.occupancyPercent || 0} tone={occupancyTone(detail.stats?.occupancyPercent || 0)} />
              <small>
                {formatNumber(detail.stats?.workerCount || 0)} عامل من أصل {formatNumber(detail.stats?.capacity || 0)} ·
                {" "}{formatNumber(detail.stats?.freePhysicalBeds || 0)} سرير فعلي شاغر
              </small>
            </div>

            <div className="panel-title">
              <div>
                <h2>عمال المتعهد</h2>
                <span>{formatNumber(detailWorkers.length)} عامل مرتبط</span>
              </div>
              {canManage && (
                <button type="button" className="secondary-btn" onClick={() => { setLinkTarget(detail); setLinkSelected([]); setLinkQuery(""); }} disabled={offline}>
                  <Link2 size={16} /> ربط عمال
                </button>
              )}
            </div>

            {detailWorkers.length ? (
              <div className="table-scroll detail-table">
                <table className="compact-table">
                  <thead>
                    <tr><th>العامل</th><th>الرقم الوظيفي</th><th>الموقع</th><th>الحالة</th><th></th></tr>
                  </thead>
                  <tbody>
                    {detailWorkers.map((worker) => (
                      <tr key={worker.id}>
                        <td><strong>{worker.name}</strong><small className="block-note">{worker.jobTitle}</small></td>
                        <td>{worker.employeeCode || "—"}</td>
                        <td>{worker.location || "غير مسكن"}</td>
                        <td><Badge tone={statusTone(worker.attendanceStatus || worker.baseStatus)}>{worker.attendanceStatus || worker.baseStatus || "—"}</Badge></td>
                        <td>
                          {canManage && (
                            <button type="button" className="icon-plain danger" title="فصل العامل" onClick={() => unlinkWorker(detail, worker)} disabled={offline || busy}>
                              <Unlink size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="لا يوجد عمال مرتبطون" hint="اربط العمال بهذا المتعهد لتتبع السعة والإشغال" />
            )}

            <div className="row-actions">
              {canManage && <button type="button" className="primary-btn" onClick={() => openEdit(detail)} disabled={offline}><Pencil size={16} /> تعديل البيانات</button>}
              <a className="secondary-btn" href={routePath(`/contractor?id=${encodeURIComponent(detail.id)}`)}>
                <ExternalLink size={16} /> بوابة المتعهد
              </a>
              {canManage && <button type="button" className="danger-btn" onClick={() => removeContractor(detail)} disabled={offline || busy}><Trash2 size={16} /> حذف</button>}
            </div>
          </div>
        )}
      </Modal>

      {/* -------------------------------- النموذج -------------------------------- */}
      <Modal
        open={formOpen}
        title={editing ? "تعديل المتعهد" : "متعهد جديد"}
        subtitle="حدد المباني والسعة التعاقدية بدقة — تُستخدم في اعتماد طلبات العمال"
        onClose={() => setFormOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setFormOpen(false)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveContractor} disabled={saving || readOnly}>
              {saving ? "جارٍ الحفظ..." : "حفظ"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="اسم المتعهد" required>
            <TextInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="نوع المتعهد">
            <Select value={draft.contractorType} onChange={(event) => setDraft({ ...draft, contractorType: event.target.value })} options={CONTRACTOR_TYPES} />
          </Field>
          <Field label="الإدارة" required hint="تحدد مسار اعتماد الطلبات — مدير الإدارة يراجعها قبل مشرف الأمن">
            <Select
              value={draft.department}
              onChange={(event) => setDraft({ ...draft, department: event.target.value })}
              placeholder="اختر الإدارة..."
              options={CONTRACTOR_DEPARTMENTS.map((department) => ({ value: department, label: department }))}
            />
          </Field>
          <Field label="الحالة">
            <Select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              options={[
                { value: "active", label: "نشط" },
                { value: "inactive", label: "موقوف" },
              ]}
            />
          </Field>
          <Field label="السعة التعاقدية (سرير)" hint="الحد الأقصى لعدد العمال المسكّنين لهذا المتعهد">
            <TextInput type="number" min={0} value={draft.bedQuota} onChange={(event) => setDraft({ ...draft, bedQuota: event.target.value })} />
          </Field>
          <Field label="الجوال">
            <TextInput value={draft.contactPhone} onChange={(event) => setDraft({ ...draft, contactPhone: event.target.value })} placeholder="05xxxxxxxx" />
          </Field>
          <Field label="البريد الإلكتروني">
            <TextInput type="email" value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} />
          </Field>
          <Field label="المباني المسموح بها" required className="full" hint="تحدد الأسرّة الفعلية المتاحة لعمال المتعهد">
            <MultiSelect
              options={buildingOptions}
              selected={draft.buildingIds}
              onChange={(values) => setDraft({ ...draft, buildingIds: values })}
              placeholder="اختر المباني..."
            />
          </Field>
          <Field label="ملاحظات" className="full">
            <TextArea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </Field>
        </div>
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>

      {/* ------------------------------ ربط العمال ------------------------------- */}
      <Modal
        open={!!linkTarget}
        title="ربط عمال بالمتعهد"
        subtitle={linkTarget ? `${linkTarget.name} — سيتم تعيين الشركة إلى اسم المتعهد` : undefined}
        onClose={() => { setLinkTarget(null); setLinkSelected([]); }}
        wide
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => { setLinkTarget(null); setLinkSelected([]); }}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveLinks} disabled={busy || readOnly || !linkSelected.length}>
              <Link2 size={16} /> ربط ({formatNumber(linkSelected.length)})
            </button>
          </>
        }
      >
        <div className="stack-lg">
          <SearchInput value={linkQuery} onChange={setLinkQuery} placeholder="بحث بالاسم أو الرقم الوظيفي..." />
          {linkSelected.length > 0 && (
            <div className="chip-row">
              {linkSelected.map((id) => {
                const resident = (data.residents || []).find((item) => item.id === id);
                return (
                  <button type="button" key={id} className="mini-chip removable" onClick={() => setLinkSelected((current) => current.filter((value) => value !== id))}>
                    {resident?.name || id} <X size={12} />
                  </button>
                );
              })}
            </div>
          )}
          <div className="check-list">
            {linkCandidates.map((resident) => (
              <label key={resident.id} className="check-item check-row">
                <input
                  type="checkbox"
                  checked={linkSelected.includes(resident.id)}
                  onChange={(event) => {
                    if (event.target.checked) setLinkSelected((current) => [...current, resident.id]);
                    else setLinkSelected((current) => current.filter((value) => value !== resident.id));
                  }}
                />
                <span>
                  <strong>{resident.name}</strong>
                  <small>{resident.employeeCode || "بدون رقم"} · {resident.company || "بدون شركة"} · {resident.location || "غير مسكن"}</small>
                </span>
              </label>
            ))}
            {!linkCandidates.length && <EmptyState title="لا يوجد سكان مطابقون" hint="جرّب بحثاً آخر" />}
          </div>
          {linkCandidates.length >= 120 && <Alert tone="info">تظهر أول 120 نتيجة — استخدم البحث لتضييق القائمة.</Alert>}
        </div>
      </Modal>
    </>
  );
}
