"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Hotel,
  RefreshCw,
  ShieldAlert,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import {
  getOperationsAttendance,
  getOperationsBoard,
  getOperationsDuty,
  getResidentsByStatus,
  type OperationsBoard,
} from "@/lib/api";
import { countBy, housingResidents } from "@/lib/analytics";
import { downloadSectionsXls, printReportSections, type ReportSection } from "@/lib/export";
import { formatDateTime, formatNumber, formatPercent, statusTone, timeAgo, todayISO } from "@/lib/format";
import { routePath } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { AttendanceReport, DutyReport, GroupRow, Resident } from "@/lib/types";
import {
  Alert,
  Badge,
  EmptyState,
  ErrorNote,
  Loader,
  PageHead,
  Progress,
  SearchInput,
  SectionTitle,
  Select,
  StatCard,
  Tabs,
} from "@/components/ui";

type TabId = "board" | "attendance" | "duty" | "status" | "pending";

const STATUS_OPTIONS = ["حاضر", "إجازة", "غير مسكن"];

const GROUP_OPTIONS = [
  { value: "company", label: "حسب الشركة / المتعهد" },
  { value: "building", label: "حسب المبنى" },
  { value: "department", label: "حسب الإدارة" },
  { value: "service", label: "حسب نوع الخدمة" },
  { value: "gender", label: "حسب الجنس" },
];

const STATUS_META: Record<string, { icon: typeof CheckCircle2; tone: "good" | "bad" | "warn" | "info" | "muted" }> = {
  حاضر: { icon: CheckCircle2, tone: "good" },
  إجازة: { icon: Hotel, tone: "warn" },
  "غير مسكن": { icon: UsersRound, tone: "muted" },
};

function classify(status: string): "present" | "away" | "leave" | "absent" | "unknown" {
  if (/إجازة|اجازة|راحة/.test(status)) return "leave";
  if (status.trim()) return "present";
  return "unknown";
}

function groupResidents(residents: Resident[], groupBy: string): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const resident of residents) {
    const label =
      (groupBy === "building" ? resident.buildingName : groupBy === "department" ? resident.department : groupBy === "service" ? resident.serviceType : groupBy === "gender" ? resident.gender : resident.company) ||
      "غير محدد";
    if (!map.has(label)) {
      map.set(label, { label, total: 0, present: 0, away: 0, leave: 0, absent: 0, assigned: 0, unassigned: 0, percent: 0 });
    }
    const row = map.get(label)!;
    row.total += 1;
    const category = classify(resident.attendanceStatus || resident.baseStatus || "");
    if (category === "present") row.present += 1;
    else if (category === "away") row.away += 1;
    else if (category === "leave") row.leave += 1;
    else if (category === "absent") row.absent += 1;
    if (resident.bedId) row.assigned += 1;
    else row.unassigned += 1;
  }
  return Array.from(map.values())
    .map((row) => ({ ...row, percent: row.total ? Math.round((row.present / row.total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);
}

function localBoard(data: NonNullable<ReturnType<typeof useApp>["data"]>, date: string): OperationsBoard {
  const housing = housingResidents(data.residents || []);
  const groups: Record<string, Resident[]> = {};
  for (const resident of housing) {
    const status = resident.attendanceStatus || resident.baseStatus || "غير محدد";
    groups[status] = groups[status] || [];
    groups[status].push(resident);
  }
  const pendingContractorRequests = (data.contractorRequests || []).filter((request) => request.stage !== "done" && request.stage !== "rejected");
  return {
    date,
    totals: {
      housingResidents: housing.length,
      byStatus: Object.fromEntries(Object.entries(groups).map(([status, rows]) => [status, rows.length])),
      pendingContractorRequests: pendingContractorRequests.length,
      pendingHousingRequests: (data.requests || []).filter((request) => request.status === "قيد المراجعة").length,
    },
    groups,
    stages: data.meta?.pendingCounts || {},
    pendingContractorRequests,
    pendingHousingRequests: (data.requests || []).filter((request) => request.status === "قيد المراجعة"),
    buildings: data.tree || [],
    recentActivity: data.auditLog || [],
  };
}

function localAttendance(data: NonNullable<ReturnType<typeof useApp>["data"]>, groupBy: string, date: string): AttendanceReport {
  const rows = groupResidents(housingResidents(data.residents || []), groupBy);
  return {
    date,
    groupBy,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    rows,
    summary: {
      present: rows.reduce((sum, row) => sum + row.present, 0),
      away: rows.reduce((sum, row) => sum + row.away, 0),
      leave: rows.reduce((sum, row) => sum + row.leave, 0),
      absent: rows.reduce((sum, row) => sum + row.absent, 0),
    },
  };
}

function localDuty(data: NonNullable<ReturnType<typeof useApp>["data"]>, date: string): DutyReport {
  const housing = housingResidents(data.residents || []).filter((resident) => resident.dutyStatus);
  const rows = housing.map((resident) => ({
    id: resident.id,
    name: resident.name,
    employeeCode: resident.employeeCode || "",
    company: resident.company || "",
    department: resident.department || "",
    shift: resident.shift || "",
    building: resident.buildingName || "",
    room: resident.roomName || "",
    status: resident.dutyStatus || "",
    workDays: resident.dutyWorkDays || 0,
    restDays: resident.dutyRestDays || 0,
    cycleStart: resident.dutyCycleStart || "",
  }));
  const onDuty = rows.filter((row) => /رأس العمل|عمل/.test(row.status));
  const onLeave = rows.filter((row) => !/رأس العمل|عمل/.test(row.status));
  return {
    date,
    rows,
    onDuty,
    onLeave,
    summary: { total: rows.length, onDuty: onDuty.length, onLeave: onLeave.length },
  };
}

const ATTENDANCE_HEADERS = ["التجميع", "الإجمالي", "حاضر", "إجازة", "بسرير", "بدون سرير", "نسبة الحضور"];
const DUTY_HEADERS = ["الاسم", "الرقم الوظيفي", "الشركة", "الإدارة", "المبنى", "الغرفة", "الحالة", "أيام العمل", "أيام الراحة"];
const STATUS_HEADERS = ["الاسم", "الرقم الوظيفي", "الشركة", "الموقع", "الحالة", "الدوام"];

export default function OperationsPage() {
  const { data, user, offline, online, reload } = useApp();
  const [tab, setTab] = useState<TabId>("board");
  const [date, setDate] = useState(todayISO());
  const [groupBy, setGroupBy] = useState("company");
  const [board, setBoard] = useState<OperationsBoard | null>(null);
  const [attendance, setAttendance] = useState<AttendanceReport | null>(null);
  const [duty, setDuty] = useState<DutyReport | null>(null);
  const [statusRows, setStatusRows] = useState<Resident[]>([]);
  const [statusFilter, setStatusFilter] = useState("حاضر");
  const [statusQuery, setStatusQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const canExport = can(user, "reports.export");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab") as TabId | null;
    if (requested && ["board", "attendance", "duty", "status", "pending"].includes(requested)) setTab(requested);
    const status = params.get("status");
    if (status) {
      setStatusFilter(status);
      setTab("status");
    }
  }, []);

  const load = useCallback(async () => {
    if (!data) return;
    setLoading(true);
    setError("");
    try {
      if (tab === "board") setBoard(await getOperationsBoard(date));
      else if (tab === "attendance") setAttendance(await getOperationsAttendance(groupBy, date));
      else if (tab === "duty") setDuty(await getOperationsDuty(date));
      else if (tab === "status") {
        const result = await getResidentsByStatus(statusFilter, statusQuery);
        setStatusRows(result.items || []);
      } else {
        setBoard(await getOperationsBoard(date));
      }
    } catch (err) {
      if (offline || !online) {
        if (tab === "board" || tab === "pending") setBoard(localBoard(data, date));
        else if (tab === "attendance") setAttendance(localAttendance(data, groupBy, date));
        else if (tab === "duty") setDuty(localDuty(data, date));
        else {
          const rows = housingResidents(data.residents || []).filter((resident) => {
            if (statusFilter && (resident.attendanceStatus || resident.baseStatus) !== statusFilter) return false;
            const needle = statusQuery.trim().toLowerCase();
            if (!needle) return true;
            return [resident.name, resident.employeeCode, resident.company, resident.location].join(" ").toLowerCase().includes(needle);
          });
          setStatusRows(rows);
        }
      } else {
        setError(err instanceof Error ? err.message : "تعذر تحميل بيانات المتابعة");
      }
    } finally {
      setLoading(false);
    }
  }, [tab, date, groupBy, statusFilter, statusQuery, data, offline, online]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date, groupBy]);

  const localDashboard = useMemo(() => (data ? localBoard(data, date) : null), [data, date]);
  const view = board || localDashboard;
  const attendanceView = attendance || (data ? localAttendance(data, groupBy, date) : null);
  const dutyView = duty || (data ? localDuty(data, date) : null);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const resident of housingResidents(data?.residents || [])) {
      const status = resident.attendanceStatus || resident.baseStatus || "غير محدد";
      counts.set(status, (counts.get(status) || 0) + 1);
    }
    return counts;
  }, [data]);

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 5000);
  }

  function attendanceSections(): ReportSection[] {
    const rows = attendanceView?.rows || [];
    return [
      {
        heading: `تجميع ${GROUP_OPTIONS.find((option) => option.value === groupBy)?.label || groupBy}`,
        headers: ATTENDANCE_HEADERS,
        rows: rows.map((row) => [row.label, row.total, row.present, row.leave, row.assigned, row.unassigned, `${row.percent}%`]),
      },
    ];
  }

  function dutySections(): ReportSection[] {
    return [
      {
        heading: `أيام العمل (${formatNumber(dutyView?.onDuty.length || 0)})`,
        headers: DUTY_HEADERS,
        rows: (dutyView?.onDuty || []).map((row) => [row.name, row.employeeCode, row.company, row.department, row.building, row.room, row.status, row.workDays, row.restDays]),
      },
      {
        heading: `في الراحة / خارج الدوام (${formatNumber(dutyView?.onLeave.length || 0)})`,
        headers: DUTY_HEADERS,
        rows: (dutyView?.onLeave || []).map((row) => [row.name, row.employeeCode, row.company, row.department, row.building, row.room, row.status, row.workDays, row.restDays]),
      },
    ];
  }

  function exportAttendance(kind: "xls" | "pdf") {
    const meta = [`التاريخ: ${date}`, `آخر تحديث: ${formatDateTime(new Date().toISOString())}`];
    if (kind === "xls") {
      downloadSectionsXls(`attendance-${date}.xls`, "الحضور", "تقرير الحضور والتواجد", meta, attendanceSections());
      notify("تم تصدير تقرير الحضور");
    } else {
      printReportSections("تقرير الحضور والتواجد", meta, attendanceSections());
    }
  }

  function exportDuty(kind: "xls" | "pdf") {
    const meta = [`التاريخ: ${date}`, `إجمالي الدوام: ${formatNumber(dutyView?.rows.length || 0)}`];
    if (kind === "xls") {
      downloadSectionsXls(`duty-${date}.xls`, "الدوام", "تقرير جدول الدوام", meta, dutySections());
      notify("تم تصدير تقرير الدوام");
    } else {
      printReportSections("تقرير جدول الدوام", meta, dutySections());
    }
  }

  function exportStatus(kind: "xls" | "pdf") {
    const sections: ReportSection[] = [
      {
        heading: `الحالة: ${statusFilter}`,
        headers: STATUS_HEADERS,
        rows: statusRows.map((row) => [row.name, row.employeeCode || "", row.company || "", row.location || "", row.attendanceStatus || "", row.dutyStatus || ""]),
      },
    ];
    const meta = [`التاريخ: ${date}`, `عدد السجلات: ${formatNumber(statusRows.length)}`];
    if (kind === "xls") {
      downloadSectionsXls(`status-${date}.xls`, "حسب الحالة", `سكان السكن — ${statusFilter}`, meta, sections);
      notify("تم تصدير القائمة");
    } else {
      printReportSections(`سكان السكن — ${statusFilter}`, meta, sections);
    }
  }

  if (!data) return <Loader label="جارٍ تحميل المتابعة..." />;

  const present = view?.totals.byStatus["حاضر"] || 0;
  const leave = view?.totals.byStatus["إجازة"] || 0;

  return (
    <>
      <PageHead
        eyebrow="المتابعة"
        title="المتابعة والحضور والدوام"
        subtitle={`${formatNumber(view?.totals.housingResidents || 0)} ساكن في السكن · ${formatDateTime(date)}`}
        actions={
          <div className="head-actions">
            <label className="date-field">
              <CalendarDays size={16} />
              <input type="date" value={date} onChange={(event) => setDate(event.target.value || todayISO())} />
            </label>
            <button type="button" className="secondary-btn" onClick={() => { reload(); load(); }} disabled={loading || busy}>
              <RefreshCw size={16} /> تحديث
            </button>
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {(offline || !online) && <Alert tone="warning">وضع دون إنترنت: تُعرض بيانات النسخة المحفوظة، وقد لا تتطابق مع التاريخ المحدد.</Alert>}

      <div className="stats-grid">
        <StatCard icon={UsersRound} label="سكان السكن" value={formatNumber(view?.totals.housingResidents || 0)} hint={`${formatNumber((data.residents || []).length)} إجمالي المسجّلين`} />
        <StatCard icon={UserRoundCheck} label="حاضرون" value={formatNumber(present)} hint={formatPercent(view?.totals.housingResidents ? (present / view.totals.housingResidents) * 100 : 0)} tone="success" />
        <StatCard icon={Hotel} label="في إجازة" value={formatNumber(leave)} tone="warn" />
        <StatCard icon={ShieldAlert} label="طلبات متعهدين معلّقة" value={formatNumber(view?.totals.pendingContractorRequests || 0)} tone="warn" />
        <StatCard icon={ClipboardList} label="طلبات سكن قيد المراجعة" value={formatNumber(view?.totals.pendingHousingRequests || 0)} tone="muted" />
        <StatCard icon={CheckCircle2} label="تناوبات مجدولة" value={formatNumber((data.rotations || []).filter((rotation) => rotation.status === "مجدول").length)} tone="primary" />
      </div>

      <Tabs
        tabs={[
          { id: "board", label: "لوحة المتابعة" },
          { id: "attendance", label: "الحضور والتجميع" },
          { id: "duty", label: "جدول الدوام" },
          { id: "status", label: "حسب الحالة" },
          { id: "pending", label: "الطلبات المعلّقة", count: (view?.totals.pendingContractorRequests || 0) + (view?.totals.pendingHousingRequests || 0) },
        ]}
        active={tab}
        onChange={(id) => setTab(id)}
      />

      {tab === "board" && view && (
        <>
          <section className="section">
            <SectionTitle title="حالات سكان السكن" hint="اضغط على الحالة لعرض القائمة الكاملة" />
            <div className="status-board">
              {Object.entries(view.groups)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([status, rows]) => {
                  const meta = STATUS_META[status] || { icon: UsersRound, tone: "info" as const };
                  const Icon = meta.icon;
                  return (
                    <button
                      type="button"
                      key={status}
                      className="status-board-card"
                      onClick={() => { setStatusFilter(status); setTab("status"); }}
                    >
                      <span className={`status-board-icon ${meta.tone}`}><Icon size={18} /></span>
                      <span className="status-board-body">
                        <strong>{formatNumber(rows.length)}</strong>
                        <small>{status}</small>
                      </span>
                      <span className="status-board-foot">
                        {rows.slice(0, 2).map((resident) => resident.name).join("، ") || "—"}
                      </span>
                    </button>
                  );
                })}
              {!Object.keys(view.groups).length && <EmptyState title="لا توجد بيانات حضور" />}
            </div>
          </section>

          <div className="dash-grid">
            <section className="chart-card">
              <SectionTitle title="الطلبات المعلّقة" hint="اعتمادات المتعهدين بانتظار الإجراء" action={<a className="link-btn" href={routePath("/requests?stage=pending")}>فتح الطلبات</a>} />
              {view.pendingContractorRequests.length ? (
                <ul className="mini-list">
                  {view.pendingContractorRequests.slice(0, 8).map((request) => (
                    <li key={request.id}>
                      <div>
                        <strong>{request.workerName}</strong>
                        <small>{request.contractorName} · {request.typeLabel || request.requestType}</small>
                      </div>
                      <Badge tone={statusTone(request.stage)}>{request.stageLabel || request.stage}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="لا توجد طلبات متعهدين معلّقة" />
              )}
            </section>

            <section className="chart-card">
              <SectionTitle title="الأسرّة والإشغال" hint={`${formatNumber(view.buildings.length)} مبنى`} action={<a className="link-btn" href={routePath("/housing")}>إدارة السكن</a>} />
              <div className="building-bars">
                {view.buildings.slice(0, 6).map((building) => (
                  <div className="building-bar" key={building.id}>
                    <div className="building-bar-head">
                      <span>
                        <strong>{building.name}</strong>
                        <small>{formatNumber(building.occupiedCount)} / {formatNumber(building.bedCount)} سرير</small>
                      </span>
                      <b className={`pct ${building.occupancyPercent >= 95 ? "bad" : building.occupancyPercent >= 80 ? "warn" : "good"}`}>
                        {formatPercent(building.occupancyPercent)}
                      </b>
                    </div>
                    <Progress value={building.occupancyPercent} tone={building.occupancyPercent >= 95 ? "bad" : building.occupancyPercent >= 80 ? "warn" : "good"} />
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="section">
            <SectionTitle title="طلبات السكن قيد المراجعة" hint="أحدث الطلبات" action={<a className="link-btn" href={routePath("/requests?tab=housing")}>عرض الكل</a>} />
            <section className="table-card">
              {view.pendingHousingRequests.length ? (
                <div className="table-scroll">
                  <table className="compact-table">
                    <thead>
                      <tr><th>النوع</th><th>الساكن</th><th>التفاصيل</th><th>الأولوية</th><th>التاريخ</th></tr>
                    </thead>
                    <tbody>
                      {view.pendingHousingRequests.slice(0, 10).map((request) => (
                        <tr key={request.id}>
                          <td>{request.requestType}</td>
                          <td>{request.residentName}</td>
                          <td className="wrap-cell">{request.details}</td>
                          <td><Badge tone={request.priority === "عاجل" ? "bad" : "muted"}>{request.priority || "عادي"}</Badge></td>
                          <td>{formatDateTime(request.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="لا توجد طلبات سكن معلّقة" />
              )}
            </section>
          </section>

          {!!view.recentActivity.length && (
            <section className="section">
              <SectionTitle title="أحدث العمليات" hint="آخر النشاطات على النظام" />
              <section className="form-panel">
                <ul className="timeline">
                  {view.recentActivity.slice(0, 8).map((entry) => (
                    <li key={entry.id}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>{entry.actorName || entry.actorUsername || "النظام"}</strong>
                        <p>{entry.action} · {entry.entity}{entry.entityId ? ` #${entry.entityId}` : ""}</p>
                        <small>{timeAgo(entry.at)}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </section>
          )}
        </>
      )}

      {tab === "attendance" && (
        <section className="section">
          <SectionTitle
            title="تقرير الحضور والتجميع"
            hint={`${formatNumber(attendanceView?.total || 0)} ساكن`}
            action={
              <div className="head-actions">
                <Select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} options={GROUP_OPTIONS} />
                {canExport && (
                  <>
                    <button type="button" className="secondary-btn" onClick={() => exportAttendance("xls")} disabled={busy}>
                      <FileSpreadsheet size={16} /> Excel
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => exportAttendance("pdf")} disabled={busy}>
                      <Download size={16} /> PDF
                    </button>
                  </>
                )}
              </div>
            }
          />
          <section className="table-card">
            {loading && !attendanceView?.rows.length ? (
              <Loader />
            ) : attendanceView?.rows.length ? (
              <div className="table-scroll">
                <table className="residents-table">
                  <thead>
                    <tr>
                      <th>التجميع</th>
                      <th>الإجمالي</th>
                      <th>حاضر</th>
                      <th>إجازة</th>
                      <th>نسبة الحضور</th>
                      <th>التغطية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceView.rows.map((row) => (
                      <tr key={row.label}>
                        <td><strong>{row.label}</strong></td>
                        <td>{formatNumber(row.total)}</td>
                        <td className="cell-good">{formatNumber(row.present)}</td>
                        <td className="cell-warn">{formatNumber(row.leave)}</td>
                        <td>{formatPercent(row.percent)}</td>
                        <td>
                          <div className="inline-progress">
                            <Progress value={row.percent} tone={row.percent >= 80 ? "good" : row.percent >= 50 ? "warn" : "bad"} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="لا توجد بيانات حضور" hint="جرّب تغيير التاريخ أو طريقة التجميع" />
            )}
          </section>
          <div className="chart-legend">
            <span><i style={{ background: "#0f9d68" }} /> حاضر</span>
            <span><i style={{ background: "#e6a700" }} /> إجازة</span>
          </div>
        </section>
      )}

      {tab === "duty" && (
        <section className="section">
          <SectionTitle
            title="جدول الدوام والتناوب الوظيفي"
            hint={`${formatNumber(dutyView?.summary.onDuty || 0)} في أيام العمل · ${formatNumber(dutyView?.summary.onLeave || 0)} في أيام الراحة`}
            action={
              canExport ? (
                <div className="head-actions">
                  <button type="button" className="secondary-btn" onClick={() => exportDuty("xls")} disabled={busy}>
                    <FileSpreadsheet size={16} /> Excel
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => exportDuty("pdf")} disabled={busy}>
                    <Download size={16} /> PDF
                  </button>
                </div>
              ) : undefined
            }
          />
          <div className="dash-grid">
            <section className="chart-card">
              <SectionTitle title="أيام العمل" hint={formatNumber(dutyView?.onDuty.length || 0)} />
              {dutyView?.onDuty.length ? (
                <div className="table-scroll">
                  <table className="compact-table">
                    <thead><tr><th>الاسم</th><th>المبنى</th><th>الدوام</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {dutyView.onDuty.slice(0, 50).map((row) => (
                        <tr key={row.id}>
                          <td><strong>{row.name}</strong><small className="block-note">{row.company}</small></td>
                          <td>{row.building || "—"}</td>
                          <td>{row.workDays} / {row.restDays}</td>
                          <td><Badge tone="good">{row.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState title="لا يوجد موظفون في أيام العمل" />}
            </section>
            <section className="chart-card">
              <SectionTitle title="في الراحة" hint={formatNumber(dutyView?.onLeave.length || 0)} />
              {dutyView?.onLeave.length ? (
                <div className="table-scroll">
                  <table className="compact-table">
                    <thead><tr><th>الاسم</th><th>المبنى</th><th>الدوام</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {dutyView.onLeave.slice(0, 50).map((row) => (
                        <tr key={row.id}>
                          <td><strong>{row.name}</strong><small className="block-note">{row.company}</small></td>
                          <td>{row.building || "—"}</td>
                          <td>{row.workDays} / {row.restDays}</td>
                          <td><Badge tone="warn">{row.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState title="لا يوجد موظفون في راحة" />}
            </section>
          </div>
        </section>
      )}

      {tab === "status" && (
        <section className="section">
          <SectionTitle
            title="سكان السكن حسب الحالة"
            hint={`${formatNumber(statusRows.length)} سجل`}
            action={
              canExport ? (
                <div className="head-actions">
                  <button type="button" className="secondary-btn" onClick={() => exportStatus("xls")} disabled={busy}>
                    <FileSpreadsheet size={16} /> Excel
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => exportStatus("pdf")} disabled={busy}>
                    <Download size={16} /> PDF
                  </button>
                </div>
              ) : undefined
            }
          />
          <section className="form-panel filters-panel">
            <div className="filters-row">
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} options={STATUS_OPTIONS.map((status) => ({ value: status, label: `${status} (${formatNumber(statusCounts.get(status) || 0)})` }))} />
              <SearchInput value={statusQuery} onChange={setStatusQuery} onSubmit={load} placeholder="بحث بالاسم أو الرقم الوظيفي..." />
              <button type="button" className="secondary-btn" onClick={load} disabled={loading}>
                <RefreshCw size={16} /> تطبيق
              </button>
            </div>
          </section>
          <section className="table-card">
            {statusRows.length ? (
              <div className="table-scroll">
                <table className="residents-table">
                  <thead>
                    <tr><th>الاسم</th><th>الرقم الوظيفي</th><th>الشركة</th><th>الموقع</th><th>الحالة</th><th>الدوام</th><th></th></tr>
                  </thead>
                  <tbody>
                    {statusRows.map((resident) => (
                      <tr key={resident.id}>
                        <td><strong>{resident.name}</strong><small className="block-note">{resident.jobTitle || resident.department}</small></td>
                        <td>{resident.employeeCode || "—"}</td>
                        <td>{resident.company || "—"}</td>
                        <td>{resident.location || "غير مسكن"}</td>
                        <td><Badge tone={statusTone(resident.attendanceStatus || resident.baseStatus)}>{resident.attendanceStatus || resident.baseStatus || "غير محدد"}</Badge></td>
                        <td>{resident.dutyStatus || resident.dutyLabel || "—"}</td>
                        <td><a className="link-btn" href={routePath(`/residents?highlight=${encodeURIComponent(resident.id)}`)}>الملف</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="لا يوجد سكان بهذه الحالة" hint="جرّب حالة أخرى أو عدّل البحث" />
            )}
          </section>
        </section>
      )}

      {tab === "pending" && view && (
        <div className="dash-grid">
          <section className="chart-card">
            <SectionTitle title="طلبات المتعهدين المعلّقة" hint={`${formatNumber(view.pendingContractorRequests.length)} طلب`} action={<a className="link-btn" href={routePath("/requests?stage=pending")}>اعتماد</a>} />
            {view.pendingContractorRequests.length ? (
              <ul className="mini-list">
                {view.pendingContractorRequests.map((request) => (
                  <li key={request.id}>
                    <div>
                      <strong>{request.workerName}</strong>
                      <small>{request.contractorName} · {request.typeLabel || request.requestType}</small>
                      <small>{timeAgo(request.createdAt)}</small>
                    </div>
                    <Badge tone={statusTone(request.stage)}>{request.stageLabel || request.stage}</Badge>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="لا توجد طلبات معلّقة" />}
          </section>
          <section className="chart-card">
            <SectionTitle title="طلبات السكن المعلّقة" hint={`${formatNumber(view.pendingHousingRequests.length)} طلب`} action={<a className="link-btn" href={routePath("/requests?tab=housing")}>مراجعة</a>} />
            {view.pendingHousingRequests.length ? (
              <ul className="mini-list">
                {view.pendingHousingRequests.map((request) => (
                  <li key={request.id}>
                    <div>
                      <strong>{request.residentName}</strong>
                      <small>{request.requestType} · {request.priority || "عادي"}</small>
                      <small>{timeAgo(request.createdAt)}</small>
                    </div>
                    <Badge tone={statusTone(request.status)}>{request.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="لا توجد طلبات معلّقة" />}
          </section>
        </div>
      )}
    </>
  );
}
