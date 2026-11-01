"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BedDouble,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import {
  assignBed,
  bulkAssignResidents,
  createResident,
  deleteResident,
  fetchTextFile,
  importResidents,
  importTemplatePath,
  residentHistory,
  residentsCsvPath,
  unassignBed,
  updateResident,
} from "@/lib/api";
import { downloadCsv } from "@/lib/export";
import { ageFrom, formatDate, formatDateTime, formatNumber, statusTone } from "@/lib/format";
import { routePath } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { AuditEntry, Resident } from "@/lib/types";
import {
  ActionRow,
  Alert,
  Badge,
  EmptyState,
  ErrorNote,
  Field,
  InfoGrid,
  Loader,
  Modal,
  PageHead,
  Pagination,
  SearchInput,
  Select,
  StatCard,
  TextArea,
  TextInput,
} from "@/components/ui";

type BedOption = {
  id: string;
  label: string;
  roomId: string;
  roomName: string;
  buildingId: string;
  buildingName: string;
  occupied: boolean;
  residentName?: string;
};

const ATTENDANCE_OPTIONS = ["حاضر", "إجازة", "غير مسكن"];

const EMPTY_FORM: Record<string, string> = {
  employeeCode: "",
  name: "",
  jobTitle: "",
  company: "",
  department: "",
  shift: "",
  rotation: "",
  serviceType: "سكن",
  phone: "",
  cardNumber: "",
  gender: "",
  birthDate: "",
  birthPlace: "",
  transportType: "",
  departureTime: "",
  notes: "",
  contractorId: "",
  buildingId: "",
  roomId: "",
  bedId: "",
  checkInDate: "",
  dutyWorkDays: "",
  dutyRestDays: "",
};

/** محلّل CSV بسيط يدعم الاقتباس والفواصل داخل الحقول. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\ufeff/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((line) => line.some((cell) => cell.trim() !== ""));
}

const HEADER_MAP: Record<string, string> = {
  employeecode: "employeeCode",
  "الرقم الوظيفي": "employeeCode",
  name: "name",
  الاسم: "name",
  jobtitle: "jobTitle",
  "المسمى الوظيفي": "jobTitle",
  company: "company",
  "الشركة/المتعهد": "company",
  department: "department",
  الإدارة: "department",
  servicetype: "serviceType",
  "نوع الخدمة": "serviceType",
  phone: "phone",
  الجوال: "phone",
  gender: "gender",
  الجنس: "gender",
  cardnumber: "cardNumber",
  "رقم البطاقة": "cardNumber",
  birthdate: "birthDate",
  "تاريخ الميلاد": "birthDate",
  birthplace: "birthPlace",
  "مكان الميلاد": "birthPlace",
  buildingid: "buildingId",
  roomid: "roomId",
  bedid: "bedId",
};

export default function ResidentsPage() {
  const { data, user, offline, reload } = useApp();
  const [query, setQuery] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [status, setStatus] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [assignment, setAssignment] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [highlight, setHighlight] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Resident | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [detail, setDetail] = useState<Resident | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);

  const [bedTarget, setBedTarget] = useState<{ resident?: Resident; bulk?: boolean } | null>(null);
  const [bedBuilding, setBedBuilding] = useState("");
  const [bedRoom, setBedRoom] = useState("");
  const [bedId, setBedId] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [importSummary, setImportSummary] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canManage = can(user, "residents.manage");
  const canBed = can(user, "housing.manage");
  const canImport = can(user, "residents.import");
  const readOnly = offline || !canManage;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("highlight");
    if (id) setHighlight(id);
    if (params.get("action") === "add" && canManage) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bedOptions = useMemo<BedOption[]>(() => {
    if (!data) return [];
    const occupiedByBed = new Map<string, string>();
    for (const resident of data.residents || []) {
      if (resident.bedId) occupiedByBed.set(resident.bedId, resident.name);
    }
    if (Array.isArray(data.tree) && data.tree.length) {
      const options: BedOption[] = [];
      for (const building of data.tree) {
        for (const room of building.rooms || []) {
          for (const bed of room.beds || []) {
            options.push({
              id: bed.id,
              label: bed.label,
              roomId: room.id,
              roomName: room.name,
              buildingId: building.id,
              buildingName: building.name,
              occupied: bed.occupied ?? occupiedByBed.has(bed.id),
              residentName: bed.residentName || occupiedByBed.get(bed.id),
            });
          }
        }
      }
      return options;
    }
    return (data.beds || []).map((bed) => {
      const room = (data.rooms || []).find((item) => item.id === bed.roomId);
      const building = (data.buildings || []).find((item) => item.id === room?.buildingId);
      return {
        id: bed.id,
        label: bed.label,
        roomId: bed.roomId,
        roomName: room?.name || "",
        buildingId: building?.id || "",
        buildingName: building?.name || "",
        occupied: occupiedByBed.has(bed.id),
        residentName: occupiedByBed.get(bed.id),
      };
    });
  }, [data]);

  const roomsFor = (building: string) => (data?.rooms || []).filter((room) => !building || room.buildingId === building);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    const rows = (data.residents || []).filter((resident) => {
      if (buildingId && resident.buildingId !== buildingId) return false;
      if (roomId && resident.roomId !== roomId) return false;
      if (serviceType && resident.serviceType !== serviceType) return false;
      if (assignment === "yes" && !resident.bedId) return false;
      if (assignment === "no" && resident.bedId) return false;
      if (status) {
        if (status === "غير مسكن") {
          if (resident.bedId) return false;
        } else {
          const current = resident.attendanceStatus || "";
          if (current !== status) return false;
        }
      }
      if (!needle) return true;
      return [resident.name, resident.employeeCode, resident.cardNumber, resident.phone, resident.company, resident.department, resident.jobTitle, resident.buildingName, resident.roomName, resident.bedLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    const key = sort.startsWith("-") ? sort.slice(1) : sort;
    const direction = sort.startsWith("-") ? -1 : 1;
    return rows.sort((a, b) => {
      const valueA = key === "employeeCode" ? a.employeeCode || "" : key === "company" ? a.company || "" : a.name || "";
      const valueB = key === "employeeCode" ? b.employeeCode || "" : key === "company" ? b.company || "" : b.name || "";
      return valueA.localeCompare(valueB, "ar") * direction;
    });
  }, [data, query, buildingId, roomId, serviceType, assignment, status, sort]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const stats = useMemo(() => {
    const all = data?.residents || [];
    return {
      total: all.length,
      assigned: all.filter((resident) => !!resident.bedId).length,
      housing: all.filter((resident) => resident.serviceType === "سكن" || resident.buildingId).length,
      contractors: all.filter((resident) => !!resident.contractorId).length,
    };
  }, [data]);

  const serviceOptions = useMemo(() => {
    const values = new Set<string>();
    for (const resident of data?.residents || []) {
      if (resident.serviceType) values.add(resident.serviceType);
    }
    return Array.from(values).sort().map((value) => ({ value, label: value }));
  }, [data]);

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
    setDraft({ ...EMPTY_FORM });
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(resident: Resident) {
    setEditing(resident);
    setDraft({
      ...EMPTY_FORM,
      ...Object.fromEntries(
        Object.entries(resident).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]),
      ),
    });
    setFormError("");
    setFormOpen(true);
  }

  async function openDetail(resident: Resident) {
    setDetail(resident);
    setHistory([]);
    try {
      const result = await residentHistory(resident.id);
      setHistory(result.items || []);
    } catch {
      setHistory([]);
    }
  }

  function setField(key: string, value: string) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === "buildingId") {
        next.roomId = "";
        next.bedId = "";
      }
      if (key === "roomId") next.bedId = "";
      return next;
    });
  }

  async function saveResident() {
    if (!draft.name.trim()) {
      setFormError("اسم الساكن مطلوب");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (value === "") continue;
        payload[key] = key === "dutyWorkDays" || key === "dutyRestDays" ? Number(value) || 0 : value;
      }
      if (editing) await updateResident(editing.id, payload);
      else await createResident(payload);
      setFormOpen(false);
      await reload();
      notify(editing ? "تم تحديث بيانات الساكن" : "تمت إضافة الساكن بنجاح");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر حفظ الساكن");
    } finally {
      setSaving(false);
    }
  }

  async function removeResident(resident: Resident) {
    if (!window.confirm(`حذف الساكن ${resident.name}؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    setBusy(true);
    try {
      await deleteResident(resident.id);
      await reload();
      notify("تم حذف الساكن");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function openBedModal(target: { resident?: Resident; bulk?: boolean }) {
    setBedTarget(target);
    setBedBuilding(target.resident?.buildingId || "");
    setBedRoom(target.resident?.roomId || "");
    setBedId("");
  }

  async function saveBed() {
    if (!bedTarget) return;
    setBusy(true);
    setError("");
    try {
      if (bedTarget.resident) {
        if (!bedId) throw new Error("اختر السرير أولاً");
        await assignBed(bedTarget.resident.id, bedId);
      } else {
        if (!bedBuilding && !bedRoom) throw new Error("اختر المبنى أو الغرفة");
        await bulkAssignResidents({
          residentIds: selected,
          buildingId: bedBuilding || undefined,
          roomId: bedRoom || undefined,
        });
      }
      setBedTarget(null);
      setSelected([]);
      await reload();
      notify("تم تخصيص السرير بنجاح");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeBed(resident: Resident) {
    if (!window.confirm(`إلغاء تخصيص سرير ${resident.name}؟`)) return;
    setBusy(true);
    try {
      await unassignBed(resident.id);
      await reload();
      notify("تم إلغاء تخصيص السرير");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    try {
      const file = await fetchTextFile(residentsCsvPath());
      downloadCsv(`residents-${new Date().toISOString().slice(0, 10)}.csv`, file.content);
      notify("تم تصدير بيانات السكان");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    setBusy(true);
    try {
      const file = await fetchTextFile(importTemplatePath());
      downloadCsv("residents-template.csv", file.content);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file: File) {
    setBusy(true);
    setImportSummary("");
    setError("");
    try {
      const text = await file.text();
      const table = parseCsv(text);
      if (table.length < 2) throw new Error("الملف لا يحتوي بيانات");
      const headers = table[0].map((header) => HEADER_MAP[header.trim().toLowerCase()] || HEADER_MAP[header.trim()] || header.trim());
      const records = table.slice(1).map((line) => {
        const record: Record<string, string> = {};
        headers.forEach((header, index) => {
          const value = (line[index] || "").trim();
          if (value) record[header] = value;
        });
        return record;
      });
      const result = await importResidents(records);
      setImportSummary(
        `تم الاستيراد: ${formatNumber(result.created)} جديد، ${formatNumber(result.updated)} محدّث، ${formatNumber(result.failed)} فاشل من ${formatNumber(result.total)} سجل.`,
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر استيراد الملف");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!data) return <Loader />;

  const formBedOptions = bedOptions.filter((bed) => {
    if (!bed.occupied) return true;
    return bed.id === draft.bedId;
  });

  return (
    <>
      <PageHead
        eyebrow="السكان"
        title="السكان والموظفون"
        subtitle={`${formatNumber(stats.total)} سجل · ${formatNumber(stats.assigned)} لديهم سرير · ${formatNumber(stats.housing)} في السكن`}
        actions={
          <div className="head-actions">
            {canImport && (
              <button type="button" className="secondary-btn" onClick={exportCsv} disabled={busy}>
                <Download size={16} /> تصدير CSV
              </button>
            )}
            <button type="button" className="secondary-btn" onClick={() => reload()} disabled={busy}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canManage && (
              <button type="button" className="primary-btn" onClick={openCreate} disabled={offline}>
                <Plus size={16} /> إضافة ساكن
              </button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {offline && <Alert tone="warning">وضع دون إنترنت: العرض فقط. أعد الاتصال لتعديل البيانات.</Alert>}

      <div className="stats-grid stats-grid-4">
        <StatCard icon={UsersRound} label="إجمالي السكان" value={formatNumber(stats.total)} />
        <StatCard icon={BedDouble} label="مخصّص لهم سرير" value={formatNumber(stats.assigned)} tone="success" />
        <StatCard icon={UsersRound} label="بدون سرير" value={formatNumber(stats.total - stats.assigned)} tone="warn" />
        <StatCard icon={UserRoundCheck} label="مرتبطون بمتعهد" value={formatNumber(stats.contractors)} tone="muted" />
      </div>

      <section className="form-panel filters-panel">
        <div className="filters-row">
          <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="بحث بالاسم أو الرقم الوظيفي أو البطاقة..." />
          <Select
            value={buildingId}
            onChange={(event) => { setBuildingId(event.target.value); setRoomId(""); setPage(1); }}
            placeholder="كل المباني"
            options={(data.buildings || []).map((building) => ({ value: building.id, label: building.name }))}
          />
          <Select
            value={roomId}
            onChange={(event) => { setRoomId(event.target.value); setPage(1); }}
            placeholder="كل الغرف"
            options={roomsFor(buildingId).map((room) => ({ value: room.id, label: room.name }))}
          />
          <Select
            value={status}
            onChange={(event) => { setStatus(event.target.value); setPage(1); }}
            placeholder="كل الحالات"
            options={ATTENDANCE_OPTIONS.map((value) => ({ value, label: value }))}
          />
          <Select
            value={serviceType}
            onChange={(event) => { setServiceType(event.target.value); setPage(1); }}
            placeholder="كل أنواع الخدمة"
            options={serviceOptions}
          />
          <Select
            value={assignment}
            onChange={(event) => { setAssignment(event.target.value); setPage(1); }}
            options={[
              { value: "all", label: "الجميع" },
              { value: "yes", label: "مخصّص له سرير" },
              { value: "no", label: "بدون سرير" },
            ]}
          />
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            options={[
              { value: "name", label: "ترتيب: الاسم" },
              { value: "-name", label: "ترتيب: الاسم تنازلياً" },
              { value: "employeeCode", label: "ترتيب: الرقم الوظيفي" },
              { value: "company", label: "ترتيب: الشركة" },
            ]}
          />
        </div>
        <div className="filters-foot">
          <span>
            النتائج: <strong>{formatNumber(total)}</strong> من {formatNumber(stats.total)}
          </span>
          <div className="filters-actions">
            <select
              className="ui-input ui-select small-select"
              value={pageSize}
              onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>{size} / صفحة</option>
              ))}
            </select>
            {canImport && (
              <button type="button" className="secondary-btn" onClick={() => setImportOpen(true)} disabled={offline}>
                <Upload size={16} /> استيراد
              </button>
            )}
          </div>
        </div>
      </section>

      {canBed && selected.length > 0 && (
        <div className="bulk-bar">
          <span>تم تحديد {formatNumber(selected.length)} ساكن</span>
          <div>
            <button type="button" className="primary-btn" onClick={() => openBedModal({ bulk: true })} disabled={offline}>
              <BedDouble size={16} /> تخصيص سرير للمحدد
            </button>
            <button type="button" className="secondary-btn" onClick={() => setSelected([])}>إلغاء التحديد</button>
          </div>
        </div>
      )}

      <section className="table-card">
        <div className="table-scroll">
          <table className="residents-table">
            <thead>
              <tr>
                {canBed && (
                  <th className="check-cell">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((resident) => selected.includes(resident.id))}
                      onChange={(event) => {
                        const pageIds = rows.map((resident) => resident.id);
                        setSelected((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, ...pageIds]))
                            : current.filter((id) => !pageIds.includes(id)),
                        );
                      }}
                      aria-label="تحديد الصفحة"
                    />
                  </th>
                )}
                <th>الساكن</th>
                <th>الرقم الوظيفي</th>
                <th>الشركة / الإدارة</th>
                <th>الموقع</th>
                <th>الحالة</th>
                <th>الدوام</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((resident) => (
                <tr key={resident.id} className={highlight === resident.id ? "row-highlight" : ""}>
                  {canBed && (
                    <td className="check-cell">
                      <input
                        type="checkbox"
                        checked={selected.includes(resident.id)}
                        onChange={() => toggleSelected(resident.id)}
                        aria-label={`تحديد ${resident.name}`}
                      />
                    </td>
                  )}
                  <td>
                    <button type="button" className="person-link" onClick={() => openDetail(resident)}>
                      <span className="person-avatar">{(resident.name || "؟").slice(0, 1)}</span>
                      <span>
                        <strong>{resident.name}</strong>
                        <small>{resident.jobTitle || "—"}{resident.age ? ` · ${resident.age} سنة` : ""}</small>
                      </span>
                    </button>
                  </td>
                  <td>{resident.employeeCode || "—"}</td>
                  <td>
                    <div className="stack-cell">
                      <span>{resident.company || "—"}</span>
                      <small>{resident.department || "—"}</small>
                    </div>
                  </td>
                  <td>
                    <div className="stack-cell">
                      <span>{resident.buildingName || "بدون مبنى"}</span>
                      <small>
                        {resident.roomName || "—"}{resident.bedLabel ? ` · سرير ${resident.bedLabel}` : ""}
                      </small>
                    </div>
                  </td>
                  <td>
                    <Badge tone={statusTone(resident.attendanceStatus || resident.baseStatus)}>
                      {resident.attendanceStatus || resident.baseStatus || "غير محدد"}
                    </Badge>
                  </td>
                  <td>
                    <div className="stack-cell">
                      <span>{resident.shift || "—"}</span>
                      <small>{resident.dutyStatus || ""}</small>
                    </div>
                  </td>
                  <td>
                    <ActionRow>
                      <button type="button" className="mini-btn" onClick={() => openDetail(resident)}>عرض</button>
                      {canManage && (
                        <button type="button" className="mini-btn" onClick={() => openEdit(resident)} disabled={offline}>
                          <Pencil size={13} /> تعديل
                        </button>
                      )}
                      {canBed && (
                        <button type="button" className="mini-btn" onClick={() => openBedModal({ resident })} disabled={offline}>
                          <BedDouble size={13} /> سرير
                        </button>
                      )}
                      {canManage && (
                        <button type="button" className="mini-btn danger" onClick={() => removeResident(resident)} disabled={offline || busy}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </ActionRow>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <EmptyState
            title="لا توجد نتائج"
            hint="جرّب تعديل البحث أو الفلاتر"
            action={canManage ? <button type="button" className="primary-btn" onClick={openCreate}><Plus size={16} /> إضافة ساكن</button> : undefined}
          />
        )}
        <Pagination page={currentPage} pages={pages} total={total} onPage={setPage} />
      </section>

      {/* نموذج إضافة/تعديل */}
      <Modal
        open={formOpen}
        title={editing ? `تعديل: ${editing.name}` : "إضافة ساكن جديد"}
        subtitle="البيانات الأساسية والسكن والدوام"
        onClose={() => setFormOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="primary-btn" onClick={saveResident} disabled={saving || offline}>
              {saving ? "جارٍ الحفظ..." : editing ? "حفظ التعديلات" : "إضافة الساكن"}
            </button>
            <button type="button" className="secondary-btn" onClick={() => setFormOpen(false)}>إلغاء</button>
          </>
        }
      >
        <ErrorNote message={formError} />
        <div className="form-grid">
          <Field label="الاسم" required>
            <TextInput value={draft.name} onChange={(event) => setField("name", event.target.value)} />
          </Field>
          <Field label="الرقم الوظيفي">
            <TextInput value={draft.employeeCode} onChange={(event) => setField("employeeCode", event.target.value)} />
          </Field>
          <Field label="المسمى الوظيفي">
            <TextInput value={draft.jobTitle} onChange={(event) => setField("jobTitle", event.target.value)} />
          </Field>
          <Field label="رقم البطاقة">
            <TextInput value={draft.cardNumber} onChange={(event) => setField("cardNumber", event.target.value)} />
          </Field>
          <Field label="الشركة / المتعهد">
            <TextInput value={draft.company} onChange={(event) => setField("company", event.target.value)} />
          </Field>
          <Field label="الإدارة">
            <TextInput value={draft.department} onChange={(event) => setField("department", event.target.value)} />
          </Field>
          <Field label="نوع الخدمة">
            <Select
              value={draft.serviceType}
              onChange={(event) => setField("serviceType", event.target.value)}
              placeholder="اختر"
              options={serviceOptions.length ? serviceOptions : [{ value: "سكن", label: "سكن" }, { value: "نقل", label: "نقل" }, { value: "أخرى", label: "أخرى" }]}
            />
          </Field>
          <Field label="نوع الدوام">
            <TextInput value={draft.shift} onChange={(event) => setField("shift", event.target.value)} placeholder="مثال: 6 أسابيع عمل / 3 راحة" />
          </Field>
          <Field label="نوع النقل">
            <TextInput value={draft.transportType} onChange={(event) => setField("transportType", event.target.value)} />
          </Field>
          <Field label="الجنس">
            <Select
              value={draft.gender}
              onChange={(event) => setField("gender", event.target.value)}
              placeholder="اختر"
              options={[{ value: "ذكر", label: "ذكر" }, { value: "أنثى", label: "أنثى" }]}
            />
          </Field>
          <Field label="الجوال">
            <TextInput value={draft.phone} onChange={(event) => setField("phone", event.target.value)} />
          </Field>
          <Field label="تاريخ الميلاد">
            <TextInput type="date" value={draft.birthDate ? draft.birthDate.slice(0, 10) : ""} onChange={(event) => setField("birthDate", event.target.value)} />
          </Field>
          <Field label="مكان الميلاد">
            <TextInput value={draft.birthPlace} onChange={(event) => setField("birthPlace", event.target.value)} />
          </Field>
          <Field label="المتعهد">
            <Select
              value={draft.contractorId}
              onChange={(event) => setField("contractorId", event.target.value)}
              placeholder="بدون متعهد"
              options={(data.contractors || []).map((contractor) => ({ value: contractor.id, label: contractor.name }))}
            />
          </Field>
          <Field label="أيام العمل في الدورة">
            <TextInput type="number" value={draft.dutyWorkDays} onChange={(event) => setField("dutyWorkDays", event.target.value)} />
          </Field>
          <Field label="أيام الراحة في الدورة">
            <TextInput type="number" value={draft.dutyRestDays} onChange={(event) => setField("dutyRestDays", event.target.value)} />
          </Field>
          <Field label="بداية دورة الدوام">
            <TextInput type="date" value={draft.dutyCycleStart ? draft.dutyCycleStart.slice(0, 10) : ""} onChange={(event) => setField("dutyCycleStart", event.target.value)} />
          </Field>
        </div>

        <div className="form-subhead">السكن</div>
        <div className="form-grid">
          <Field label="المبنى">
            <Select
              value={draft.buildingId}
              onChange={(event) => setField("buildingId", event.target.value)}
              placeholder="بدون مبنى"
              options={(data.buildings || []).map((building) => ({ value: building.id, label: building.name }))}
            />
          </Field>
          <Field label="الغرفة">
            <Select
              value={draft.roomId}
              onChange={(event) => setField("roomId", event.target.value)}
              placeholder="بدون غرفة"
              options={roomsFor(draft.buildingId).map((room) => ({ value: room.id, label: room.name }))}
            />
          </Field>
          <Field label="السرير">
            <Select
              value={draft.bedId}
              onChange={(event) => setField("bedId", event.target.value)}
              placeholder="بدون سرير"
              options={formBedOptions
                .filter((bed) => !draft.roomId || bed.roomId === draft.roomId)
                .map((bed) => ({
                  value: bed.id,
                  label: `${bed.buildingName} · ${bed.roomName} · ${bed.label}${bed.occupied ? " (مشغول)" : ""}`,
                }))}
            />
          </Field>
          <Field label="تاريخ السكن">
            <TextInput type="date" value={draft.checkInDate ? draft.checkInDate.slice(0, 10) : ""} onChange={(event) => setField("checkInDate", event.target.value)} />
          </Field>
        </div>

        <Field label="ملاحظات">
          <TextArea rows={3} value={draft.notes} onChange={(event) => setField("notes", event.target.value)} />
        </Field>
      </Modal>

      {/* تفاصيل الساكن */}
      <Modal
        open={!!detail}
        title={detail?.name || "تفاصيل الساكن"}
        subtitle={detail?.jobTitle}
        onClose={() => setDetail(null)}
        wide
        footer={
          <>
            {detail && canManage && (
              <button type="button" className="primary-btn" onClick={() => { setDetail(null); openEdit(detail); }} disabled={offline}>
                <Pencil size={15} /> تعديل
              </button>
            )}
            <button type="button" className="secondary-btn" onClick={() => setDetail(null)}>إغلاق</button>
          </>
        }
      >
        {detail && (
          <>
            <InfoGrid
              items={[
                { label: "الرقم الوظيفي", value: detail.employeeCode },
                { label: "رقم البطاقة", value: detail.cardNumber },
                { label: "الشركة", value: detail.company },
                { label: "الإدارة", value: detail.department },
                { label: "نوع الخدمة", value: detail.serviceType },
                { label: "الحالة", value: <Badge tone={statusTone(detail.attendanceStatus || detail.baseStatus)}>{detail.attendanceStatus || detail.baseStatus}</Badge> },
                { label: "المبنى", value: detail.buildingName },
                { label: "الغرفة / السرير", value: `${detail.roomName || "—"}${detail.bedLabel ? ` / ${detail.bedLabel}` : ""}` },
                { label: "المتعهد", value: detail.contractorId ? (data.contractors || []).find((item) => item.id === detail.contractorId)?.name : "—" },
                { label: "الدوام", value: detail.shift },
                { label: "دورة الدوام", value: detail.dutyCycleStart ? formatDate(detail.dutyCycleStart) : "—" },
                { label: "العمر", value: detail.age ?? ageFrom(detail.birthDate) ?? "—" },
                { label: "الجوال", value: detail.phone },
                { label: "مكان الميلاد", value: detail.birthPlace },
                { label: "تاريخ السكن", value: detail.checkInDate ? formatDate(detail.checkInDate) : "—" },
                { label: "آخر تحديث", value: detail.updatedAt ? formatDateTime(detail.updatedAt) : "—" },
              ]}
            />
            {detail.notes && <p className="muted">{detail.notes}</p>}
            <div className="form-subhead">سجل التغييرات</div>
            {history.length ? (
              <ul className="history-list">
                {history.slice(0, 20).map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.action}</strong>
                    <span>{entry.actorName || entry.actorUsername || "النظام"}</span>
                    <small>{formatDateTime(entry.at)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">لا توجد تغييرات مسجّلة لهذا الساكن.</p>
            )}
          </>
        )}
      </Modal>

      {/* تخصيص سرير */}
      <Modal
        open={!!bedTarget}
        title={bedTarget?.bulk ? "تخصيص سرير للمحدد" : "تخصيص سرير"}
        subtitle={bedTarget?.bulk ? `${selected.length} ساكن — سيتم التخصيص حسب الأسرّة الشاغرة` : bedTarget?.resident?.name}
        onClose={() => setBedTarget(null)}
        footer={
          <>
            <button type="button" className="primary-btn" onClick={saveBed} disabled={busy || offline}>
              {busy ? "جارٍ التنفيذ..." : "تخصيص"}
            </button>
            {bedTarget?.resident?.bedId && (
              <button type="button" className="danger-btn" onClick={() => { removeBed(bedTarget.resident!); setBedTarget(null); }} disabled={busy || offline}>
                إلغاء السرير الحالي
              </button>
            )}
            <button type="button" className="secondary-btn" onClick={() => setBedTarget(null)}>إلغاء</button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="المبنى">
            <Select
              value={bedBuilding}
              onChange={(event) => { setBedBuilding(event.target.value); setBedRoom(""); setBedId(""); }}
              placeholder="اختر المبنى"
              options={(data.buildings || []).map((building) => ({ value: building.id, label: building.name }))}
            />
          </Field>
          <Field label="الغرفة">
            <Select
              value={bedRoom}
              onChange={(event) => { setBedRoom(event.target.value); setBedId(""); }}
              placeholder="اختر الغرفة"
              options={roomsFor(bedBuilding).map((room) => ({ value: room.id, label: room.name }))}
            />
          </Field>
          {!bedTarget?.bulk && (
            <Field label="السرير" className="span-2">
              <Select
                value={bedId}
                onChange={(event) => setBedId(event.target.value)}
                placeholder="اختر السرير"
                options={bedOptions
                  .filter((bed) => (!bedBuilding || bed.buildingId === bedBuilding) && (!bedRoom || bed.roomId === bedRoom))
                  .map((bed) => ({
                    value: bed.id,
                    label: `${bed.buildingName} · ${bed.roomName} · ${bed.label}${bed.occupied ? ` (مشغول: ${bed.residentName || ""})` : " (شاغر)"}`,
                  }))}
              />
            </Field>
          )}
        </div>
        {bedTarget?.bulk && (
          <p className="hint">سيتم تخصيص الأسرّة الشاغرة بالتتابع داخل المبنى أو الغرفة المحددة، ويُتخطى من لا يوجد له سرير.</p>
        )}
      </Modal>

      {/* الحضور */}

      {/* الاستيراد */}
      <Modal
        open={importOpen}
        title="استيراد بيانات السكان"
        subtitle="ملف CSV بترميز UTF-8"
        onClose={() => setImportOpen(false)}
        footer={<button type="button" className="secondary-btn" onClick={() => setImportOpen(false)}>إغلاق</button>}
      >
        <div className="import-box">
          <FileSpreadsheet size={34} />
          <p>
            استخدم القالب الرسمي لضمان توافق الأعمدة. يتم تحديث السجلات الموجودة عبر الرقم الوظيفي أو رقم البطاقة.
          </p>
          <div className="head-actions">
            <button type="button" className="secondary-btn" onClick={downloadTemplate} disabled={busy}>
              <Download size={16} /> تنزيل القالب
            </button>
            <button type="button" className="primary-btn" onClick={() => fileRef.current?.click()} disabled={busy || offline}>
              <Upload size={16} /> اختيار ملف CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleImport(file);
              }}
            />
          </div>
          {importSummary && <Alert tone="success">{importSummary}</Alert>}
        </div>
      </Modal>

      <div className="page-foot-links">
        <a href={routePath("/housing")}>عرض شجرة السكن والأسرّة</a>
        <a href={routePath("/reports")}>تقارير السكان</a>
      </div>
    </>
  );
}
