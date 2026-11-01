"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BedDouble,
  CalendarClock,
  Download,
  DoorOpen,
  LogIn,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  Alert,
  Badge,
  EmptyState,
  ErrorNote,
  Field,
  Loader,
  Modal,
  PageHead,
  SearchInput,
  Select,
  StatCard,
  TextArea,
  TextInput,
} from "@/components/ui";
import {
  createGuest,
  deleteGuest,
  endGuest,
  extendGuest,
  getHousingTree,
  listGuests,
} from "@/lib/api";
import { downloadCsv, downloadSectionsXls, printReportSections, type ReportSection } from "@/lib/export";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { Guest } from "@/lib/types";

const APPROVAL_OPTIONS = [
  { value: "الإدارة العليا", label: "الإدارة العليا" },
  { value: "مدير الشؤون الإدارية", label: "مدير الشؤون الإدارية" },
  { value: "مشرف السكن", label: "مشرف السكن" },
];

const STATUS_OPTIONS = [
  { value: "staying", label: "مقيم" },
  { value: "extended", label: "مُمدَّد" },
  { value: "ended", label: "منتهٍ" },
];

const housingTypeLabel: Record<string, string> = { internal: "سكن داخلي", external: "سكن خارجي" };

export default function GuestsPage() {
  const { user, data, online, offline, reload } = useApp();
  const [rows, setRows] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState<null | { kind: "create" } | { kind: "extend"; guest: Guest } | { kind: "end"; guest: Guest }>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const [draft, setDraft] = useState({
    name: "", cardNumber: "", birthDate: "", birthPlace: "", fromPlace: "",
    department: "", approvalBy: "مشرف السكن", visitPurpose: "", startDate: "", days: "1", bedId: "", notes: "",
  });
  const [extDraft, setExtDraft] = useState({ days: "1", reason: "", approvalBy: "مشرف السكن", sameHousing: true, newBedId: "" });
  const [endReason, setEndReason] = useState("");
  const [beds, setBeds] = useState<Array<{ id: string; label: string; roomName: string; buildingName: string; housingType: string }>>([]);

  const canView = can(user, "guests.view");
  const canManage = can(user, "guests.manage");

  useEffect(() => {
    // يعمل دون إنترنت: listGuests يقرأ تلقائياً النسخة المحلية عند تعذر الخادم.
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await listGuests({ status, q, page: 1, pageSize: 500 });
        if (!cancelled) setRows(res.items || []);
        setError("");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "تعذر تحميل الزوار");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, q, reload, data]);

  useEffect(() => {
    if (!canManage) return;
    (async () => {
      try {
        // مع الخادم تستخدم شجرة السكن الحية، ودون الإنترنت تُبنى من اللقطة المحلية.
        const treeSource = online && !offline ? await getHousingTree() : data?.tree ? { buildings: data.tree } : null;
        if (!treeSource) return;
        const tree = treeSource;
        const freeBeds: Array<{ id: string; label: string; roomName: string; buildingName: string; housingType: string }> = [];
        for (const building of tree.buildings || []) {
          for (const room of building.rooms || []) {
            for (const bed of room.beds || []) {
              if (!bed.occupied) {
                freeBeds.push({
                  id: bed.id,
                  label: bed.label,
                  roomName: room.name,
                  buildingName: building.name,
                  housingType: (building as unknown as { housingType?: string }).housingType || "internal",
                });
              }
            }
          }
        }
        setBeds(freeBeds);
      } catch {
        /* القوائم الشاغرة تُعاد عند فتح النموذج */
      }
    })();
  }, [canManage, online, offline, reload, data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (status) list = list.filter((g) => g.status === status);
    if (needle) {
      list = list.filter((g) =>
        [g.name, g.cardNumber, g.department, g.formNo].some((v) => (v || "").toLowerCase().includes(needle)),
      );
    }
    return list;
  }, [rows, status, q]);

  const activeCount = filtered.filter((g) => g.status !== "ended").length;
  const stayedCount = filtered.reduce((sum, g) => sum + (g.status !== "ended" ? g.days || 0 : 0), 0);

  function notify(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 4000);
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "تعذر تنفيذ الإجراء");
  }

  function openCreate() {
    setDraft({
      name: "", cardNumber: "", birthDate: "", birthPlace: "", fromPlace: "",
      department: "", approvalBy: "مشرف السكن", visitPurpose: "", startDate: new Date().toISOString().slice(0, 10),
      days: "1", bedId: "", notes: "",
    });
    setFormError("");
    setDialog({ kind: "create" });
  }

  function openExtend(guest: Guest) {
    setExtDraft({ days: "1", reason: "", approvalBy: "مشرف السكن", sameHousing: true, newBedId: "" });
    setFormError("");
    setDialog({ kind: "extend", guest });
  }

  function openEnd(guest: Guest) {
    setEndReason("");
    setFormError("");
    setDialog({ kind: "end", guest });
  }

  async function submitDelete(guest: Guest) {
    if (!window.confirm(`حذف ملف الزائر «${guest.name}»؟ لا يمكن التراجع عن الحذف.`)) return;
    setBusy(true);
    try {
      await deleteGuest(guest.id);
      notify(offline ? "حُذف محلياً — سيتزامن تلقائياً مع الخادم" : "حُذف ملف الزائر");
      const res = await listGuests({ status, q, page: 1, pageSize: 500 });
      setRows(res.items || []);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    if (!draft.name.trim() || !draft.cardNumber.trim() || !draft.birthDate || !draft.bedId) {
      setFormError("أكمل البيانات الأساسية (الاسم، البطاقة، الميلاد، السرير)");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await createGuest({
        name: draft.name.trim(),
        cardNumber: draft.cardNumber.trim(),
        birthDate: draft.birthDate,
        birthPlace: draft.birthPlace.trim(),
        fromPlace: draft.fromPlace.trim(),
        department: draft.department.trim(),
        approvalBy: draft.approvalBy,
        visitPurpose: draft.visitPurpose.trim(),
        startDate: draft.startDate,
        days: Math.max(1, Number(draft.days) || 1),
        bedId: draft.bedId,
        notes: draft.notes.trim(),
      });
      setDialog(null);
      notify(offline ? "سُجِّل الزائر محلياً — سيتزامن تلقائياً مع الخادم" : "تم تسجيل الزائر وتسكينه");
      const res = await listGuests({ status, q, page: 1, pageSize: 500 });
      setRows(res.items || []);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر تسجيل الزائر");
    } finally {
      setBusy(false);
    }
  }

  async function submitExtend() {
    if (dialog?.kind !== "extend") return;
    if (!extDraft.reason.trim()) {
      setFormError("يجب إدخال سبب التمديد");
      return;
    }
    if (!extDraft.sameHousing && !extDraft.newBedId) {
      setFormError("حدد السكن الجديد أو اختر «بنفس السكن»");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await extendGuest(dialog.guest.id, {
        days: Math.max(1, Number(extDraft.days) || 1),
        reason: extDraft.reason.trim(),
        approvalBy: extDraft.approvalBy,
        sameHousing: extDraft.sameHousing,
        newBedId: extDraft.sameHousing ? undefined : extDraft.newBedId,
      });
      setDialog(null);
      notify(offline ? "سُجِّل التمديد محلياً — سيتزامن تلقائياً مع الخادم" : "تم تسجيل التمديد");
      const res = await listGuests({ status, q, page: 1, pageSize: 500 });
      setRows(res.items || []);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر تنفيذ التمديد");
    } finally {
      setBusy(false);
    }
  }

  async function submitEnd() {
    if (dialog?.kind !== "end") return;
    setBusy(true);
    setFormError("");
    try {
      await endGuest(dialog.guest.id, { reason: endReason.trim() });
      setDialog(null);
      notify(offline ? "أُنهيت الإقامة محلياً — سيتزامن تلقائياً مع الخادم" : "تم إنهاء إقامة الزائر وإخلاء السرير");
      const res = await listGuests({ status, q, page: 1, pageSize: 500 });
      setRows(res.items || []);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر إنهاء الإقامة");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsvServer() {
    // CSV يُولَّد محلياً من صفوف الصفحة مباشرة — لا يحتاج الخادم ويعمل دون إنترنت.
    const sections = reportSections();
    const headers = sections[0]?.headers || [];
    const rows = sections[0]?.rows || [];
    const escape = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [
      headers.map(escape).join(","),
      ...rows.map((row) => row.map(escape).join(",")),
    ].join("\r\n");
    downloadCsv(`guests-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${csv}`);
    notify(offline ? "تم تنزيل ملف CSV (دون إنترنت)" : "تم تنزيل ملف CSV");
  }

  function reportSections(): ReportSection[] {
    return [
      {
        headers: ["رقم النموذج", "الاسم", "رقم البطاقة", "الجهة", "الإدارة", "جهة الاعتماد", "غرض الزيارة", "المبنى", "الغرفة", "السرير", "من", "إلى", "الأيام", "الحالة"],
        rows: filtered.map((g) => [
          g.formNo ?? "", g.name, g.cardNumber, g.fromPlace ?? "", g.department ?? "", g.approvalBy ?? "", g.visitPurpose ?? "",
          g.housing?.buildingName ?? "", g.housing?.roomName ?? "", g.housing?.bedLabel ?? "",
          g.startDate ?? "", g.endDate ?? "", g.days ?? 0, g.statusLabel ?? "",
        ]),
      },
    ];
  }

  const generated = `تم الإنشاء: ${formatDateTime(new Date().toISOString() || "")} · الطلب: ${filtered.length}`;

  return (
    <div className="page">
      <PageHead
        eyebrow="شؤون الزوار"
        title="بوابة الزوار"
        subtitle={canView ? "سجل الزوار المعتمدين وتسكينهم وتمديدهم" : "تسجيل وتسكين وتمديد الزوار المعتمدين"}
        actions={
          <>
            <button type="button" className="secondary-btn" onClick={() => void refreshList()}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canManage && (
              <button type="button" className="primary-btn" onClick={openCreate}>
                <LogIn size={16} /> إضافة زائر
              </button>
            )}
          </>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <ErrorNote message={error} />}

      <div className="stats-grid">
        <StatCard icon={UserRound} label="عدد الزوار" value={formatNumber(filtered.length)} />
        <StatCard icon={DoorOpen} label="إقامات نشطة" value={formatNumber(activeCount)} />
        <StatCard icon={CalendarClock} label="إجمالي أيام الإقامة" value={formatNumber(stayedCount)} />
      </div>

      {canView ? (
        <>
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="ابحث بالاسم أو البطاقة أو النموذج..." />
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              placeholder="كل الحالات"
              options={STATUS_OPTIONS}
              className="toolbar-select"
            />
            {can(user, "reports.export") && (
              <>
                <button type="button" className="secondary-btn" onClick={exportCsvServer} disabled={busy}>
                  <Download size={16} /> CSV
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() =>
                    downloadSectionsXls(
                      `guests-${new Date().toISOString().slice(0, 10)}`,
                      "الزوار",
                      "سجل الزوار",
                      [generated],
                      reportSections(),
                    )
                  }
                  disabled={busy}
                >
                  <Download size={16} /> Excel
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void printReportSections("سجل الزوار", [generated], reportSections())}
                  disabled={busy}
                >
                  <Download size={16} /> طباعة
                </button>
              </>
            )}
          </div>

          {loading ? (
            <Loader label="جارٍ تحميل الزوار..." />
          ) : filtered.length === 0 ? (
            <EmptyState title="لا يوجد زوار" hint="لم تُسجَّل أي إقامة زائر مطابقة للبحث." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>النموذج</th>
                    <th>الاسم</th>
                    <th>البطاقة</th>
                    <th>السكن</th>
                    <th>الإقامة</th>
                    <th>جهة الاعتماد</th>
                    <th>الحالة</th>
                    {canManage && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((guest) => (
                    <tr key={guest.id}>
                      <td className="mono">{guest.formNo}</td>
                      <td>
                        <b>{guest.name}</b>
                        <small className="muted block">{guest.department}</small>
                      </td>
                      <td className="mono">{guest.cardNumber}</td>
                      <td>
                        {guest.housing?.buildingName || "—"}
                        <small className="muted block">
                          {guest.housing?.roomName} · {guest.housing?.bedLabel}
                          {guest.housing?.housingType ? ` · ${housingTypeLabel[guest.housing.housingType]}` : ""}
                        </small>
                      </td>
                      <td>
                        {formatDate(guest.startDate)} → {formatDate(guest.endDate)}
                        <small className="muted block">{guest.days} يوم</small>
                      </td>
                      <td>{guest.approvalBy}</td>
                      <td>
                        <Badge tone={guest.status === "ended" ? "muted" : "good"}>{guest.statusLabel}</Badge>
                      </td>
                      {canManage && (
                        <td className="actions">
                                          {guest.status !== "ended" && (
                            <>
                              <button type="button" className="small-btn" onClick={() => openExtend(guest)}>
                                <CalendarClock size={14} /> تمديد
                              </button>
                              <button type="button" className="danger-btn small" onClick={() => openEnd(guest)}>
                                <DoorOpen size={14} /> إنهاء
                              </button>
                            </>
                          )}
                          {can(user, "guests.manage") && (
                            <button type="button" className="danger-btn small" onClick={() => void submitDelete(guest)} disabled={busy}>
                              <Trash2 size={14} /> حذف
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="تسجيل الزوار"
          hint="لا تظهر لك تقارير سجل الزوار — يمكنك فقط تسجيل زائر وتسكينه أو تمديد إقامته."
        />
      )}

      {/* نموذج تسجيل زائر */}
      <Modal
        open={dialog?.kind === "create"}
        title="إضافة زائر"
        subtitle="بيانات الزائر المعتمد — جهة الاعتماد خارج النظام (إدارة عليا / شؤون إدارية / مشرف سكن)"
        onClose={() => setDialog(null)}
        wide
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={() => void submitCreate()} disabled={busy}>
              {busy ? "جارٍ الحفظ..." : "تسكين الزائر"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="اسم الزائر" required>
            <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="رقم البطاقة" required>
            <TextInput value={draft.cardNumber} onChange={(e) => setDraft({ ...draft, cardNumber: e.target.value })} />
          </Field>
          <Field label="تاريخ الميلاد" required>
            <TextInput type="date" value={draft.birthDate} onChange={(e) => setDraft({ ...draft, birthDate: e.target.value })} />
          </Field>
          <Field label="محل الميلاد" required>
            <TextInput value={draft.birthPlace} onChange={(e) => setDraft({ ...draft, birthPlace: e.target.value })} />
          </Field>
          <Field label="الجهة القادم منها" required>
            <TextInput value={draft.fromPlace} onChange={(e) => setDraft({ ...draft, fromPlace: e.target.value })} />
          </Field>
          <Field label="الإدارة التابع لها في الشركة" required>
            <TextInput value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} />
          </Field>
          <Field label="جهة الاعتماد" required>
            <Select value={draft.approvalBy} onChange={(e) => setDraft({ ...draft, approvalBy: e.target.value })} options={APPROVAL_OPTIONS} />
          </Field>
          <Field label="غرض الزيارة" required>
            <TextInput value={draft.visitPurpose} onChange={(e) => setDraft({ ...draft, visitPurpose: e.target.value })} />
          </Field>
          <Field label="تاريخ التسكين">
            <TextInput type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
          </Field>
          <Field label="عدد أيام التسكين" hint="بين 1 و 90 يوماً">
            <TextInput type="number" min={1} max={90} value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} />
          </Field>
          <Field label="اسم السكن / الغرفة / السرير" required hint="من قاعدة السكن الشاغر">
            <Select
              value={draft.bedId}
              onChange={(e) => setDraft({ ...draft, bedId: e.target.value })}
              placeholder="اختر سريراً شاغراً"
              options={beds.map((bed) => ({
                value: bed.id,
                label: `${bed.buildingName} · ${bed.roomName} · ${bed.label}${bed.housingType ? ` · ${housingTypeLabel[bed.housingType] || ""}` : ""}`,
              }))}
            />
          </Field>
          <Field label="ملاحظات" className="span-2">
            <TextArea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
        </div>
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>

      {/* تمديد */}
      <Modal
        open={dialog?.kind === "extend"}
        title={`تمديد إقامة: ${dialog?.kind === "extend" ? dialog.guest.name : ""}`}
        subtitle={dialog?.kind === "extend" ? `حتى ${formatDate(dialog.guest.endDate)}` : ""}
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={() => void submitExtend()} disabled={busy}>
              {busy ? "جارٍ الحفظ..." : "تسجيل التمديد"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="عدد الأيام المُمدَّدة" required>
            <TextInput type="number" min={1} max={90} value={extDraft.days} onChange={(e) => setExtDraft({ ...extDraft, days: e.target.value })} />
          </Field>
          <Field label="جهة الاعتماد" required>
            <Select value={extDraft.approvalBy} onChange={(e) => setExtDraft({ ...extDraft, approvalBy: e.target.value })} options={APPROVAL_OPTIONS} />
          </Field>
          <Field label="السكن" required>
            <Select
              value={extDraft.sameHousing ? "same" : "new"}
              onChange={(e) => setExtDraft({ ...extDraft, sameHousing: e.target.value === "same", newBedId: "" })}
              options={[
                { value: "same", label: `بنفس السكن (${dialog?.kind === "extend" ? dialog.guest.housing?.bedLabel : ""})` },
                { value: "new", label: "تم تغييره في مكان آخر" },
              ]}
            />
          </Field>
          {!extDraft.sameHousing && (
            <Field label="السكن الجديد" required>
              <Select
                value={extDraft.newBedId}
                onChange={(e) => setExtDraft({ ...extDraft, newBedId: e.target.value })}
                placeholder="اختر سريراً شاغراً"
                options={beds.map((bed) => ({
                  value: bed.id,
                  label: `${bed.buildingName} · ${bed.roomName} · ${bed.label}`,
                }))}
              />
            </Field>
          )}
          <Field label="سبب التمديد" required className="span-2">
            <TextArea rows={2} value={extDraft.reason} onChange={(e) => setExtDraft({ ...extDraft, reason: e.target.value })} />
          </Field>
        </div>
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>

      {/* إنهاء */}
      <Modal
        open={dialog?.kind === "end"}
        title={`إنهاء إقامة: ${dialog?.kind === "end" ? dialog.guest.name : ""}`}
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>إلغاء</button>
            <button type="button" className="danger-btn" onClick={() => void submitEnd()} disabled={busy}>
              {busy ? "جارٍ الإنهاء..." : "إنهاء الإقامة"}
            </button>
          </>
        }
      >
        <p className="muted">سيتم إخلاء السرير ({dialog?.kind === "end" ? dialog.guest.housing?.bedLabel : ""}) وإتاحته للسكان.</p>
        <Field label="السبب">
          <TextInput value={endReason} onChange={(e) => setEndReason(e.target.value)} placeholder="نهاية الزيارة" />
        </Field>
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>
    </div>
  );

  async function refreshList() {
    setLoading(true);
    try {
      const res = await listGuests({ status, q, page: 1, pageSize: 500 });
      setRows(res.items || []);
      setError("");
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }
}
