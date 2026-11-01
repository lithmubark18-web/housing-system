"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BedDouble,
  Building2,
  CalendarCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Handshake,
  Printer,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { AreaChart, BarList, DonutChart, Gauge } from "@/components/Charts";
import {
  Alert,
  Badge,
  EmptyState,
  ErrorNote,
  Field,
  Loader,
  PageHead,
  Progress,
  SearchInput,
  SectionTitle,
  Select,
  StatCard,
  Tabs,
  TextInput,
  occupancyTone,
} from "@/components/ui";
import {
  fetchTextFile,
  getAttendanceReport,
  getContractorsReport,
  getDutyReport,
  getOccupancyReport,
  getRequestsReport,
  reportCsvPath,
  type ContractorsReport,
  type OccupancyReport,
  type RequestsReport,
} from "@/lib/api";
import {
  attendanceSummary,
  contractorStageCounts,
  contractorUsage,
  housingResidents,
  monthlyFromRequests,
  occupancySummary,
} from "@/lib/analytics";
import { downloadCsv, downloadSectionsXls, printReportSections, type ReportSection } from "@/lib/export";
import { formatDate, formatDateTime, formatNumber, formatPercent, statusTone, todayISO } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { AttendanceReport, BuildingTree, DutyReport, GroupRow, Resident } from "@/lib/types";

type TabId = "dashboard" | "attendance" | "occupancy" | "contractors" | "requests" | "duty";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "dashboard", label: "لوحة التقارير" },
  { id: "attendance", label: "الحضور" },
  { id: "occupancy", label: "الإشغال" },
  { id: "contractors", label: "المتعهدون" },
  { id: "requests", label: "الطلبات" },
  { id: "duty", label: "الدوام" },
];

const GROUP_OPTIONS = [
  { value: "company", label: "حسب الشركة" },
  { value: "building", label: "حسب المبنى" },
  { value: "department", label: "حسب الإدارة" },
  { value: "service", label: "حسب نوع الخدمة" },
  { value: "gender", label: "حسب الجنس" },
  { value: "duty", label: "حسب الوردية" },
];

const STAGE_LABELS: Record<string, string> = {
  housing: "اعتماد السكن",
  security: "الاعتماد الأمني",
  visitor: "اعتماد الزوار",
  done: "مكتمل",
  rejected: "مرفوض",
};

const HOUSING_TYPE_LABELS: Record<string, string> = { internal: "سكن داخلي", external: "سكن خارجي" };

const REPORT_TYPE_OPTIONS = [
  { value: "", label: "كل أنواع السكن" },
  { value: "internal", label: "سكن داخلي" },
  { value: "external", label: "سكن خارجي" },
];

function groupRows(residents: Resident[], keyOf: (resident: Resident) => string): GroupRow[] {
  const buckets = new Map<string, Resident[]>();
  for (const resident of residents) {
    const key = (keyOf(resident) || "غير محدد").trim() || "غير محدد";
    const list = buckets.get(key);
    if (list) list.push(resident);
    else buckets.set(key, [resident]);
  }
  return Array.from(buckets.entries())
    .map(([label, items]) => {
      const present = items.filter((item) => item.attendanceStatus === "حاضر").length;
      const leave = items.filter((item) => item.attendanceStatus === "إجازة").length;
      const assigned = items.filter((item) => item.isAssigned || item.bedId).length;
      return {
        label,
        total: items.length,
        present,
        away: 0,
        leave,
        absent: 0,
        assigned,
        unassigned: items.length - assigned,
        percent: items.length ? Math.round((present / items.length) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "ar"));
}

export default function ReportsPage() {
  const { data, user, offline, online, reload } = useApp();
  const [tab, setTab] = useState<TabId>("dashboard");
  const [date, setDate] = useState(todayISO());
  const [groupBy, setGroupBy] = useState("company");
  const [query, setQuery] = useState("");
  const [reportType, setReportType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [remoteAttendance, setRemoteAttendance] = useState<AttendanceReport | null>(null);
  const [remoteOccupancy, setRemoteOccupancy] = useState<OccupancyReport | null>(null);
  const [remoteContractors, setRemoteContractors] = useState<ContractorsReport | null>(null);
  const [remoteRequests, setRemoteRequests] = useState<RequestsReport | null>(null);
  const [remoteDuty, setRemoteDuty] = useState<DutyReport | null>(null);

  const canExport = can(user, "reports.export");
  const connected = online && !offline;

  useEffect(() => {
    if (!data || !connected) return;
    let cancelled = false;
    (async () => {
      try {
        if (tab === "attendance") {
          const report = await getAttendanceReport(groupBy, date);
          if (!cancelled) setRemoteAttendance(report);
        } else if (tab === "occupancy") {
          const report = await getOccupancyReport();
          if (!cancelled) setRemoteOccupancy(report);
        } else if (tab === "contractors") {
          const report = await getContractorsReport();
          if (!cancelled) setRemoteContractors(report);
        } else if (tab === "requests") {
          const report = await getRequestsReport();
          if (!cancelled) setRemoteRequests(report);
        } else if (tab === "duty") {
          const report = await getDutyReport(date);
          if (!cancelled) setRemoteDuty(report);
        }
      } catch {
        /* يُستخدم الحساب المحلي عند تعذر جلب التقرير */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, date, groupBy, data?.generatedAt, connected]);

  const model = useMemo(() => {
    if (!data) return null;
    const residents = housingResidents(data.residents || []);
    const all = data.residents || [];
    const attendance = attendanceSummary(residents);
    const occupancy = occupancySummary(data.tree || [], data.beds || []);
    const contractors = contractorUsage(data.contractors || []);
    const stages = contractorStageCounts(data.contractorRequests || []);
    const pendingStages = stages.filter((stage) => !["done", "rejected"].includes(stage.stage));
    const housingStatuses = new Map<string, number>();
    const housingTypes = new Map<string, number>();
    for (const request of data.requests || []) {
      housingStatuses.set(request.status, (housingStatuses.get(request.status) || 0) + 1);
      housingTypes.set(request.requestType, (housingTypes.get(request.requestType) || 0) + 1);
    }
    const roomsById = new Map((data.rooms || []).map((room) => [room.id, room]));
    const buildingsById = new Map((data.buildings || []).map((building) => [building.id, building]));
    const dutyRows: DutyReport["rows"] = residents
      .filter((resident) => !!resident.dutyStatus)
      .map((resident) => ({
        id: resident.id,
        name: resident.name,
        employeeCode: resident.employeeCode || "",
        company: resident.company || "",
        department: resident.department || "",
        shift: resident.shift || "",
        building: resident.buildingName || buildingsById.get(resident.buildingId || "")?.name || "",
        room: resident.roomName || roomsById.get(resident.roomId || "")?.name || "",
        status: resident.dutyStatus || "",
        workDays: resident.dutyWorkDays || 0,
        restDays: resident.dutyRestDays || 0,
        cycleStart: resident.dutyCycleStart || "",
      }));
    const dutyLeave = dutyRows.filter((row) => row.status === "إجازة");
    const dutyOn = dutyRows.filter((row) => row.status === "مداوم");
    return {
      residents,
      all,
      attendance,
      occupancy,
      contractors,
      stages,
      pendingStageTotal: pendingStages.reduce((sum, stage) => sum + stage.value, 0),
      housingStatuses,
      housingTypes,
      dutyRows,
      dutyOn,
      dutyLeave,
      monthly: monthlyFromRequests(data.contractorRequests || []),
      buildings: (data.tree || []).slice().sort((a, b) => b.occupancyPercent - a.occupancyPercent),
    };
  }, [data]);

  const localAttendance = useMemo<AttendanceReport | null>(() => {
    if (!model) return null;
    const keyOf: Record<string, (resident: Resident) => string> = {
      company: (resident) => resident.company || "",
      building: (resident) => resident.buildingName || "",
      department: (resident) => resident.department || "",
      service: (resident) => resident.serviceType || "",
      gender: (resident) => resident.gender || "",
      duty: (resident) => resident.shift || "",
    };
    const rows = groupRows(model.residents, keyOf[groupBy] || keyOf.company);
    return {
      date,
      groupBy,
      total: model.residents.length,
      rows,
      summary: {
        present: rows.reduce((sum, row) => sum + row.present, 0),
        away: rows.reduce((sum, row) => sum + row.away, 0),
        leave: rows.reduce((sum, row) => sum + row.leave, 0),
        absent: rows.reduce((sum, row) => sum + row.absent, 0),
        assigned: rows.reduce((sum, row) => sum + row.assigned, 0),
        unassigned: rows.reduce((sum, row) => sum + row.unassigned, 0),
      },
    };
  }, [model, groupBy, date]);

  const localOccupancy = useMemo<OccupancyReport | null>(() => {
    if (!data || !model) return null;
    const rows = (data.tree || []).map((building: BuildingTree) => ({
      id: building.id,
      name: building.name,
      location: building.location,
      rooms: building.roomCount,
      beds: building.bedCount,
      occupied: building.occupiedCount,
      free: building.freeCount,
      percent: building.occupancyPercent,
    }));
    return {
      rows,
      totals: {
        beds: rows.reduce((sum, row) => sum + row.beds, 0),
        occupied: rows.reduce((sum, row) => sum + row.occupied, 0),
        free: rows.reduce((sum, row) => sum + row.free, 0),
        percent: model.occupancy.percent,
      },
      buildings: data.tree || [],
    };
  }, [data, model]);

  const localContractors = useMemo<ContractorsReport | null>(() => {
    if (!data) return null;
    const rows = (data.contractors || []).map((contractor) => {
      const stats = contractor.stats;
      return {
        id: contractor.id,
        name: contractor.name,
        type: contractor.contractorType,
        status: contractor.status,
        contactPhone: contractor.contactPhone,
        contactEmail: contractor.contactEmail,
        buildingNames: (contractor.buildingNames || []).join("، "),
        workerCount: stats?.workerCount || 0,
        capacity: stats?.capacity || contractor.bedQuota || 0,
        freeQuota: stats?.freeQuota || 0,
        physicalBeds: stats?.physicalBeds || 0,
        occupiedBeds: stats?.occupiedBeds || 0,
        freePhysicalBeds: stats?.freePhysicalBeds || 0,
        occupancyPercent: stats?.occupancyPercent || 0,
        pendingRequests: stats?.pendingRequests || 0,
      };
    });
    return {
      rows,
      summary: {
        contractors: rows.length,
        capacity: rows.reduce((sum, row) => sum + row.capacity, 0),
        occupied: rows.reduce((sum, row) => sum + row.workerCount, 0),
        free: rows.reduce((sum, row) => sum + row.freeQuota, 0),
        physicalBeds: rows.reduce((sum, row) => sum + row.physicalBeds, 0),
        freePhysicalBeds: rows.reduce((sum, row) => sum + row.freePhysicalBeds, 0),
      },
    };
  }, [data]);

  const localRequests = useMemo<RequestsReport | null>(() => {
    if (!data) return null;
    const contractorRequests = data.contractorRequests || [];
    const stages: Record<string, number> = {};
    const types: Record<string, number> = {};
    const byContractor = new Map<string, { label: string; total: number; pending: number; done: number; rejected: number }>();
    for (const request of contractorRequests) {
      stages[request.stage] = (stages[request.stage] || 0) + 1;
      types[request.requestType] = (types[request.requestType] || 0) + 1;
      const key = request.contractorName || "غير محدد";
      const bucket = byContractor.get(key) || { label: key, total: 0, pending: 0, done: 0, rejected: 0 };
      bucket.total += 1;
      if (request.stage === "done") bucket.done += 1;
      else if (request.stage === "rejected") bucket.rejected += 1;
      else bucket.pending += 1;
      byContractor.set(key, bucket);
    }
    const statuses: Record<string, number> = {};
    const housingTypes: Record<string, number> = {};
    for (const request of data.requests || []) {
      statuses[request.status] = (statuses[request.status] || 0) + 1;
      housingTypes[request.requestType] = (housingTypes[request.requestType] || 0) + 1;
    }
    return {
      contractorRequests: {
        total: contractorRequests.length,
        pending: (stages.security || 0) + (stages.visitor || 0) + (stages.housing || 0),
        done: stages.done || 0,
        rejected: stages.rejected || 0,
        stages,
        types,
        byContractor: Array.from(byContractor.values()).sort((a, b) => b.total - a.total),
      },
      housingRequests: {
        total: (data.requests || []).length,
        statuses,
        types: housingTypes,
        byType: Object.entries(housingTypes)
          .map(([label, total]) => ({ label, total }))
          .sort((a, b) => b.total - a.total),
      },
    };
  }, [data]);

  const localDuty = useMemo<DutyReport | null>(() => {
    if (!model) return null;
    return {
      date,
      rows: model.dutyRows,
      onDuty: model.dutyOn,
      onLeave: model.dutyLeave,
      summary: {
        withSchedule: model.dutyRows.length,
        onDuty: model.dutyOn.length,
        onLeave: model.dutyLeave.length,
        withoutSchedule: model.residents.length - model.dutyRows.length,
      },
    };
  }, [model, date]);

  const attendance = remoteAttendance || localAttendance;
  const occupancy = remoteOccupancy || localOccupancy;
  const contractors = remoteContractors || localContractors;
  const requests = remoteRequests || localRequests;
  const duty = remoteDuty || localDuty;

  /** نوع السكن (داخلي/خارجي) لكل مبنى — من بيانات الإقلاع */
  const buildingTypeById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const building of data?.buildings || []) {
      map[building.id] = building.housingType === "external" ? "external" : "internal";
    }
    return map;
  }, [data]);

  /** نتائج مُرشَّحة حسب نوع السكن + كلمة بحث (تعمل على اللوحة والإشغال) */
  const filteredReports = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (id: string, name: string) => {
      if (reportType && buildingTypeById[id] !== reportType) return false;
      if (needle && !String(name || "").toLowerCase().includes(needle)) return false;
      return true;
    };
    return {
      buildings: (model?.buildings || []).filter((building) => matches(building.id, building.name)),
      occupancyRows: (occupancy?.rows || []).filter((row) => matches(row.id, row.name)),
    };
  }, [model, occupancy, query, reportType, buildingTypeById]);

  function notify(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 4000);
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "تعذر تنفيذ الإجراء");
  }

  async function exportServerCsv(kind: string) {
    setBusy(true);
    try {
      const file = await fetchTextFile(reportCsvPath(kind, date));
      downloadCsv(file.filename || `${kind}-${date}.csv`, file.content);
      notify("تم تنزيل ملف CSV من الخادم");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function currentReport(): { title: string; file: string; sheet: string; sections: ReportSection[]; meta: string[] } {
    if (!model) return { title: "تقرير", file: "report", sheet: "تقرير", sections: [], meta: [] };
    const generated = `تم الإنشاء: ${formatDateTime(new Date().toISOString())} · التاريخ: ${formatDate(date)}`;
    if (tab === "attendance" && attendance) {
      return {
        title: "تقرير الحضور والإجازات",
        file: `attendance-${date}`,
        sheet: "الحضور",
        meta: [generated, `التجميع: ${GROUP_OPTIONS.find((option) => option.value === groupBy)?.label || groupBy}`, `الإجمالي: ${attendance.total}`],
        sections: [
          {
            headers: ["المجموعة", "الإجمالي", "حاضر", "إجازة", "مسكن", "غير مسكن", "نسبة الحضور %"],
            rows: attendance.rows.map((row) => [row.label, row.total, row.present, row.leave, row.assigned, row.unassigned, row.percent]),
          },
        ],
      };
    }
    if (tab === "occupancy" && occupancy) {
      return {
        title: "تقرير إشغال السكن",
        file: `occupancy-${date}`,
        sheet: "الإشغال",
        meta: [generated, `الأسرّة: ${occupancy.totals.beds} · المشغول: ${occupancy.totals.occupied} · الشاغر: ${occupancy.totals.free}`],
        sections: [
          {
            headers: ["المبنى", "الموقع", "الغرف", "الأسرّة", "المشغول", "الشاغر", "نسبة الإشغال %"],
            rows: occupancy.rows.map((row) => [row.name, row.location || "", row.rooms, row.beds, row.occupied, row.free, row.percent]),
          },
        ],
      };
    }
    if (tab === "contractors" && contractors) {
      return {
        title: "تقرير المتعهدين والسعة",
        file: `contractors-${date}`,
        sheet: "المتعهدون",
        meta: [generated, `المتعهدون: ${contractors.summary.contractors || contractors.rows.length}`],
        sections: [
          {
            headers: ["المتعهد", "النوع", "الحالة", "المباني", "السعة", "المسكنون", "الشاغر", "الأسرّة الفعلية", "الشاغر الفعلي", "نسبة الإشغال %"],
            rows: contractors.rows.map((row) => [
              row.name, row.type || "", row.status || "", row.buildingNames || "", row.capacity, row.workerCount, row.freeQuota,
              row.physicalBeds, row.freePhysicalBeds, row.occupancyPercent,
            ]),
          },
        ],
      };
    }
    if (tab === "requests" && requests) {
      return {
        title: "تقرير الطلبات والاعتمادات",
        file: `requests-${date}`,
        sheet: "الطلبات",
        meta: [generated],
        sections: [
          {
            heading: "طلبات المتعهدين حسب المتعهد",
            headers: ["المتعهد", "الإجمالي", "معلّق", "مكتمل", "مرفوض"],
            rows: requests.contractorRequests.byContractor.map((row) => [row.label, row.total, row.pending, row.done, row.rejected]),
          },
          {
            heading: "طلبات السكن حسب الحالة",
            headers: ["الحالة", "العدد"],
            rows: Object.entries(requests.housingRequests.statuses).map(([label, value]) => [label, value]),
          },
        ],
      };
    }
    if (tab === "duty" && duty) {
      return {
        title: "تقرير الدوام والورديات",
        file: `duty-${date}`,
        sheet: "الدوام",
        meta: [generated, `مداوم: ${duty.summary.onDuty} · إجازة: ${duty.summary.onLeave} · بدون جدول: ${duty.summary.withoutSchedule}`],
        sections: [
          {
            headers: ["الاسم", "الرقم الوظيفي", "الشركة", "الإدارة", "المبنى", "الغرفة", "الحالة", "أيام العمل", "أيام الراحة"],
            rows: duty.rows.map((row) => [row.name, row.employeeCode, row.company, row.department, row.building, row.room, row.status, row.workDays, row.restDays]),
          },
        ],
      };
    }
    return {
      title: "ملخص لوحة التقارير",
      file: `dashboard-${date}`,
      sheet: "الملخص",
      meta: [generated],
      sections: [
        {
          headers: ["المؤشر", "القيمة"],
          rows: [
            ["سكان السكن", model.residents.length],
            ["إجمالي المسجلين", model.all.length],
            ["المباني", (data?.buildings || []).length],
            ["الأسرّة", model.occupancy.beds],
            ["المشغولة", model.occupancy.occupied],
            ["الشاغرة", model.occupancy.free],
            ["نسبة الإشغال %", model.occupancy.percent],
            ["حاضرون", model.attendance.present],
            ["إجازة", model.attendance.leave],
            ["طلبات متعهدين معلّقة", model.pendingStageTotal],
          ],
        },
      ],
    };
  }

  function exportExcel() {
    const report = currentReport();
    if (!report.sections.length) {
      setError("لا توجد بيانات لتصديرها");
      return;
    }
    downloadSectionsXls(`${report.file}.xls`, report.sheet, report.title, report.meta, report.sections);
    notify("تم تصدير ملف Excel");
  }

  function exportPdf() {
    const report = currentReport();
    if (!report.sections.length) {
      setError("لا توجد بيانات للطباعة");
      return;
    }
    if (!printReportSections(report.title, report.meta, report.sections)) {
      setError("تعذر فتح نافذة الطباعة — تحقق من إعدادات المتصفح");
      return;
    }
    notify("تم فتح معاينة الطباعة");
  }

  if (!data || !model) return <Loader label="جارٍ تحميل التقارير..." />;

  const maxStage = Math.max(...model.stages.map((stage) => stage.value), 1);

  return (
    <>
      <PageHead
        eyebrow="التقارير والتحليلات"
        title="مركز التقارير"
        subtitle={`${formatNumber(model.residents.length)} ساكن · ${formatNumber((data.buildings || []).length)} مبنى · ${formatPercent(model.occupancy.percent)} إشغال`}
        actions={
          <div className="head-actions">
            <button type="button" className="secondary-btn" onClick={() => reload()} disabled={busy}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canExport && (
              <>
                <button type="button" className="secondary-btn" onClick={exportExcel} disabled={busy}>
                  <FileSpreadsheet size={16} /> Excel
                </button>
                <button type="button" className="secondary-btn" onClick={exportPdf} disabled={busy}>
                  <Printer size={16} /> PDF
                </button>
                <button type="button" className="primary-btn" onClick={() => exportServerCsv(tab === "dashboard" ? "employees" : tab)} disabled={busy || !connected}>
                  <Download size={16} /> CSV
                </button>
              </>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {!connected && <Alert tone="warning">وضع دون إنترنت: تُحسب التقارير محلياً من النسخة المحفوظة، والتصدير من الخادم غير متاح.</Alert>}

      <Tabs tabs={TABS.map((item) => ({ ...item }))} active={tab} onChange={setTab} />

      <section className="form-panel filters-panel">
        <div className="filters-row">
          <Field label="تاريخ التقرير">
            <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          {(tab === "attendance" || tab === "dashboard") && (
            <Field label="تجميع الحضور">
              <Select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} options={GROUP_OPTIONS} />
            </Field>
          )}
          {(tab === "dashboard" || tab === "occupancy") && (
            <>
              <Field label="نوع السكن">
                <Select value={reportType} onChange={(event) => setReportType(event.target.value)} options={REPORT_TYPE_OPTIONS} />
              </Field>
              <Field label="بحث">
                <SearchInput value={query} onChange={setQuery} placeholder="ابحث باسم المبنى..." />
              </Field>
            </>
          )}
          <div className="filters-spacer" />
          <div className="filters-foot inline">
            <span>
              المصدر: <strong>{remoteAttendance || remoteOccupancy || remoteContractors || remoteRequests || remoteDuty ? "الخادم" : "نسخة محلية"}</strong>
            </span>
          </div>
        </div>
      </section>

      {/* ------------------------------- اللوحة ------------------------------- */}
      {tab === "dashboard" && (
        <>
          <div className="stats-grid">
            <StatCard icon={UsersRound} label="سكان السكن" value={formatNumber(model.residents.length)} hint={`من ${formatNumber(model.all.length)} مسجّل`} />
            <StatCard icon={BedDouble} label="الأسرّة المشغولة" value={`${formatNumber(model.occupancy.occupied)} / ${formatNumber(model.occupancy.beds)}`} hint={`${formatPercent(model.occupancy.percent)} إشغال`} tone={occupancyTone(model.occupancy.percent)} />
            <StatCard icon={CalendarCheck} label="حاضرون اليوم" value={formatNumber(model.attendance.present)} hint={`${formatPercent(model.residents.length ? (model.attendance.present / model.residents.length) * 100 : 0)} من الساكنين`} tone="success" />
            <StatCard icon={ShieldCheck} label="طلبات معلّقة" value={formatNumber(model.pendingStageTotal + (model.housingStatuses.get("قيد المراجعة") || 0))} hint={`${formatNumber(model.pendingStageTotal)} متعهدين`} tone="warn" />
            <StatCard icon={Building2} label="المباني" value={formatNumber((data.buildings || []).length)} hint={`${formatNumber((data.rooms || []).length)} غرفة`} tone="info" />
            <StatCard icon={Handshake} label="المتعهدون" value={formatNumber(model.contractors.length)} hint={`${formatNumber(model.contractors.reduce((sum, item) => sum + item.workers, 0))} عامل`} tone="muted" />
          </div>

          <div className="dash-grid">
            <section className="chart-card">
              <SectionTitle title="نسبة الإشغال العامة" hint={`${formatNumber(model.occupancy.occupied)} من ${formatNumber(model.occupancy.beds)} سرير`} />
              <div className="gauge-row">
                <Gauge percent={model.occupancy.percent} label="إشغال السكن" size={148} />
                <div className="gauge-facts">
                  <div><span>أسرّة شاغرة</span><strong>{formatNumber(model.occupancy.free)}</strong></div>
                  <div><span>غير مسكّنين</span><strong>{formatNumber(model.attendance.unassigned)}</strong></div>
                  <div><span>إشغال المتعهدين</span><strong>{formatPercent(model.contractors.length ? model.contractors.reduce((sum, item) => sum + item.workers, 0) / Math.max(1, model.contractors.reduce((sum, item) => sum + item.capacity, 0)) * 100 : 0)}</strong></div>
                </div>
              </div>
            </section>

            <section className="chart-card">
              <SectionTitle title="حالة سكان السكن" hint={formatDate(date)} />
              <DonutChart
                data={[
                  { label: "حاضر", value: model.attendance.present, color: "#0f9d68" },
                  { label: "إجازة", value: model.attendance.leave, color: "#e6a700" },
                ].filter((slice) => slice.value > 0)}
                centerLabel="ساكن"
                size={190}
              />
            </section>
          </div>

          <div className="dash-grid">
            <section className="chart-card">
              <SectionTitle title="الإشغال حسب المبنى" hint={`${filteredReports.buildings.length} من ${model.buildings.length} مبنى`} />
              <div className="building-bars">
                {filteredReports.buildings.map((building) => (
                  <div className="building-bar" key={building.id}>
                    <div className="building-bar-head">
                      <span>
                        <strong>{building.name}</strong>
                        <small>
                          {formatNumber(building.occupiedCount)} / {formatNumber(building.bedCount)} سرير
                          {buildingTypeById[building.id] ? ` · ${HOUSING_TYPE_LABELS[buildingTypeById[building.id]]}` : ""}
                        </small>
                      </span>
                      <b className={`pct ${occupancyTone(building.occupancyPercent)}`}>{formatPercent(building.occupancyPercent)}</b>
                    </div>
                    <Progress value={building.occupancyPercent} tone={occupancyTone(building.occupancyPercent)} />
                  </div>
                ))}
                {!filteredReports.buildings.length && <EmptyState title="لا توجد مباني مطابقة" hint="عدّل نوع السكن أو كلمة البحث" />}
              </div>
            </section>

            <section className="chart-card">
              <SectionTitle title="طلبات المتعهدين الشهرية" hint="آخر 6 أشهر" />
              <AreaChart points={model.monthly} height={200} label="الطلبات الشهرية" />
            </section>
          </div>

          <section className="section">
            <SectionTitle title="مسار اعتماد طلبات المتعهدين" hint="حسب المرحلة" />
            <div className="workflow">
              {model.stages.map((stage) => (
                <div key={stage.stage} className={`workflow-step stage-${stage.stage}`}>
                  <span className="workflow-body">
                    <small>{stage.label}</small>
                    <strong>{formatNumber(stage.value)}</strong>
                  </span>
                  <div className="workflow-track">
                    <span style={{ width: `${(stage.value / maxStage) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="table-card">
            <SectionTitle title="أعلى المتعهدين إشغالاً" hint={`${model.contractors.length} متعهد`} />
            <div className="table-scroll">
              <table className="compact-table">
                <thead>
                  <tr><th>المتعهد</th><th>العمال</th><th>السعة</th><th>الإشغال</th><th>معلّق</th></tr>
                </thead>
                <tbody>
                  {model.contractors.slice(0, 10).map((contractor) => (
                    <tr key={contractor.id}>
                      <td><strong>{contractor.name}</strong><small className="block-note">{contractor.buildings.slice(0, 2).join("، ") || "بدون مبانٍ"}</small></td>
                      <td>{formatNumber(contractor.workers)}</td>
                      <td>{formatNumber(contractor.capacity)}</td>
                      <td>
                        <div className="inline-progress">
                          <Progress value={contractor.percent} tone={occupancyTone(contractor.percent)} />
                          <small>{formatPercent(contractor.percent)}</small>
                        </div>
                      </td>
                      <td>{contractor.pendingRequests ? <Badge tone="warn">{formatNumber(contractor.pendingRequests)}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!model.contractors.length && <EmptyState title="لا يوجد متعهدون" />}
            </div>
          </section>
        </>
      )}

      {/* ------------------------------- الحضور ------------------------------- */}
      {tab === "attendance" && attendance && (
        <>
          <div className="stats-grid stats-grid-4">
            <StatCard icon={UsersRound} label="إجمالي الساكنين" value={formatNumber(attendance.total)} hint={`${formatNumber(attendance.rows.length)} مجموعة`} />
            <StatCard icon={CalendarCheck} label="حاضرون" value={formatNumber(attendance.summary.present)} hint={formatPercent(attendance.total ? (attendance.summary.present / attendance.total) * 100 : 0)} tone="success" />
            <StatCard icon={UsersRound} label="في إجازة" value={formatNumber(attendance.summary.leave)} hint={formatPercent(attendance.total ? (attendance.summary.leave / attendance.total) * 100 : 0)} tone="warn" />
            <StatCard icon={ShieldCheck} label="بدون سرير" value={formatNumber(attendance.summary.unassigned)} hint="على خدمة السكن دون تسكين" tone="muted" />
          </div>

          <section className="table-card">
            <SectionTitle title="تقرير الحضور حسب المجموعة" hint={`التجميع: ${GROUP_OPTIONS.find((option) => option.value === groupBy)?.label || groupBy}`} />
            <div className="table-scroll">
              <table className="residents-table">
                <thead>
                  <tr>
                    <th>المجموعة</th>
                    <th>الإجمالي</th>
                    <th>حاضر</th>
                    <th>إجازة</th>
                    <th>مسكن</th>
                    <th>نسبة الحضور</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.rows.map((row) => (
                    <tr key={row.label}>
                      <td><strong>{row.label}</strong></td>
                      <td>{formatNumber(row.total)}</td>
                      <td>{formatNumber(row.present)}</td>
                      <td>{formatNumber(row.leave)}</td>
                      <td>{formatNumber(row.assigned)} / {formatNumber(row.total)}</td>
                      <td>
                        <div className="inline-progress">
                          <Progress value={row.percent} tone={occupancyTone(100 - row.percent)} />
                          <small>{formatPercent(row.percent)}</small>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!attendance.rows.length && <EmptyState title="لا توجد بيانات حضور" />}
            </div>
          </section>

          <section className="chart-card">
            <SectionTitle title="توزيع الحضور" />
            <BarList
              data={[
                { label: "حاضر", value: attendance.summary.present || 0, color: "#0f9d68" },
                { label: "إجازة", value: attendance.summary.leave || 0, color: "#e6a700" },
              ]}
              max={attendance.total || 1}
            />
          </section>
        </>
      )}

      {/* ------------------------------- الإشغال ------------------------------ */}
      {tab === "occupancy" && occupancy && (
        <>
          <div className="stats-grid stats-grid-4">
            <StatCard icon={BedDouble} label="إجمالي الأسرّة" value={formatNumber(occupancy.totals.beds)} />
            <StatCard icon={BedDouble} label="مشغولة" value={formatNumber(occupancy.totals.occupied)} tone="warn" />
            <StatCard icon={BedDouble} label="شاغرة" value={formatNumber(occupancy.totals.free)} tone="success" />
            <StatCard icon={BarChart3} label="نسبة الإشغال" value={formatPercent(occupancy.totals.percent)} tone={occupancyTone(occupancy.totals.percent)} />
          </div>

          <div className="dash-grid">
            <section className="chart-card">
              <SectionTitle title="الإشغال الكلي" />
              <div className="gauge-row">
                <Gauge percent={occupancy.totals.percent} label="إجمالي السكن" size={148} />
                <div className="gauge-facts">
                  <div><span>مشغول</span><strong>{formatNumber(occupancy.totals.occupied)}</strong></div>
                  <div><span>شاغر</span><strong>{formatNumber(occupancy.totals.free)}</strong></div>
                  <div><span>الأسرّة</span><strong>{formatNumber(occupancy.totals.beds)}</strong></div>
                </div>
              </div>
            </section>
            <section className="chart-card">
              <SectionTitle title="الأسرّة الشاغرة حسب المبنى" hint={`${filteredReports.occupancyRows.length} من ${occupancy.rows.length} مبنى`} />
              <BarList data={filteredReports.occupancyRows.map((row) => ({ label: row.name, value: row.free }))} />
            </section>
          </div>

          <section className="table-card">
            <SectionTitle title="تفصيل الإشغال حسب المبنى" hint={`${filteredReports.occupancyRows.length} من ${occupancy.rows.length} مبنى`} />
            <div className="table-scroll">
              <table className="residents-table">
                <thead>
                  <tr><th>المبنى</th><th>النوع</th><th>الموقع</th><th>الغرف</th><th>الأسرّة</th><th>المشغول</th><th>الشاغر</th><th>الإشغال</th></tr>
                </thead>
                <tbody>
                  {filteredReports.occupancyRows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name}</strong></td>
                      <td>{buildingTypeById[row.id] ? <Badge tone={buildingTypeById[row.id] === "external" ? "warn" : "info"}>{HOUSING_TYPE_LABELS[buildingTypeById[row.id]]}</Badge> : "—"}</td>
                      <td>{row.location || "—"}</td>
                      <td>{formatNumber(row.rooms)}</td>
                      <td>{formatNumber(row.beds)}</td>
                      <td>{formatNumber(row.occupied)}</td>
                      <td>{formatNumber(row.free)}</td>
                      <td>
                        <div className="inline-progress">
                          <Progress value={row.percent} tone={occupancyTone(row.percent)} />
                          <small>{formatPercent(row.percent)}</small>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredReports.occupancyRows.length && <EmptyState title="لا توجد مباني مطابقة" hint="عدّل نوع السكن أو كلمة البحث" />}
            </div>
          </section>
        </>
      )}

      {/* ------------------------------ المتعهدون ----------------------------- */}
      {tab === "contractors" && contractors && (
        <>
          <div className="stats-grid stats-grid-4">
            <StatCard icon={Handshake} label="المتعهدون" value={formatNumber(contractors.summary.contractors || contractors.rows.length)} />
            <StatCard icon={UsersRound} label="العمال المسكّنون" value={formatNumber(contractors.summary.occupied || 0)} hint={`${formatNumber(contractors.summary.capacity || 0)} سعة`} tone="success" />
            <StatCard icon={BedDouble} label="شاغر تعاقدي" value={formatNumber(contractors.summary.free || 0)} tone="info" />
            <StatCard icon={BedDouble} label="شاغر فعلي" value={formatNumber(contractors.summary.freePhysicalBeds || 0)} hint={`من ${formatNumber(contractors.summary.physicalBeds || 0)} سرير`} tone="warn" />
          </div>

          <section className="table-card">
            <SectionTitle title="تحليل سعة المتعهدين" hint="السعة التعاقدية مقابل الأسرّة الفعلية" />
            <div className="table-scroll">
              <table className="residents-table">
                <thead>
                  <tr><th>المتعهد</th><th>المباني</th><th>العمال / السعة</th><th>الشاغر التعاقدي</th><th>الأسرّة الفعلية</th><th>الإشغال</th><th>معلّق</th></tr>
                </thead>
                <tbody>
                  {contractors.rows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name}</strong><small className="block-note">{row.contactPhone || row.contactEmail || "—"}</small></td>
                      <td>{row.buildingNames || "—"}</td>
                      <td>{formatNumber(row.workerCount)} / {formatNumber(row.capacity)}</td>
                      <td>{formatNumber(row.freeQuota)}</td>
                      <td>{formatNumber(row.occupiedBeds)} / {formatNumber(row.physicalBeds)}<small className="block-note">{formatNumber(row.freePhysicalBeds)} شاغر</small></td>
                      <td>
                        <div className="inline-progress">
                          <Progress value={row.occupancyPercent} tone={occupancyTone(row.occupancyPercent)} />
                          <small>{formatPercent(row.occupancyPercent)}</small>
                        </div>
                      </td>
                      <td>{row.pendingRequests ? <Badge tone="warn">{formatNumber(row.pendingRequests)}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!contractors.rows.length && <EmptyState title="لا يوجد متعهدون" />}
            </div>
          </section>

          <section className="chart-card">
            <SectionTitle title="نسبة إشغال السعة" />
            <BarList data={contractors.rows.map((row) => ({ label: row.name, value: row.occupancyPercent }))} valueSuffix="%" max={100} />
          </section>
        </>
      )}

      {/* ------------------------------- الطلبات ------------------------------ */}
      {tab === "requests" && requests && (
        <>
          <div className="stats-grid stats-grid-4">
            <StatCard icon={ShieldCheck} label="طلبات المتعهدين" value={formatNumber(requests.contractorRequests.total)} hint={`${formatNumber(requests.contractorRequests.pending)} معلّق`} />
            <StatCard icon={CalendarCheck} label="مكتملة" value={formatNumber(requests.contractorRequests.done)} tone="success" />
            <StatCard icon={ShieldCheck} label="مرفوضة" value={formatNumber(requests.contractorRequests.rejected)} tone="danger" />
            <StatCard icon={FileText} label="طلبات السكن" value={formatNumber(requests.housingRequests.total)} hint={`${formatNumber(requests.housingRequests.statuses["قيد المراجعة"] || 0)} قيد المراجعة`} tone="info" />
          </div>

          <div className="dash-grid">
            <section className="chart-card">
              <SectionTitle title="طلبات المتعهدين حسب المرحلة" />
              <DonutChart
                data={Object.entries(requests.contractorRequests.stages).map(([stage, value]) => ({
                  label: STAGE_LABELS[stage] || stage,
                  value,
                  color: stage === "done" ? "#0f9d68" : stage === "rejected" ? "#dc3e55" : undefined,
                }))}
                centerLabel="طلب"
                size={190}
              />
            </section>
            <section className="chart-card">
              <SectionTitle title="طلبات السكن حسب الحالة" />
              <BarList data={Object.entries(requests.housingRequests.statuses).map(([label, value]) => ({ label, value }))} />
            </section>
          </div>

          <section className="table-card">
            <SectionTitle title="طلبات المتعهدين حسب المتعهد" />
            <div className="table-scroll">
              <table className="compact-table">
                <thead><tr><th>المتعهد</th><th>الإجمالي</th><th>معلّق</th><th>مكتمل</th><th>مرفوض</th><th>نسبة الإنجاز</th></tr></thead>
                <tbody>
                  {requests.contractorRequests.byContractor.map((row) => (
                    <tr key={row.label}>
                      <td><strong>{row.label}</strong></td>
                      <td>{formatNumber(row.total)}</td>
                      <td>{formatNumber(row.pending)}</td>
                      <td>{formatNumber(row.done)}</td>
                      <td>{formatNumber(row.rejected)}</td>
                      <td>
                        <div className="inline-progress">
                          <Progress value={row.total ? (row.done / row.total) * 100 : 0} tone="good" />
                          <small>{formatPercent(row.total ? (row.done / row.total) * 100 : 0)}</small>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!requests.contractorRequests.byContractor.length && <EmptyState title="لا توجد طلبات متعهدين" />}
            </div>
          </section>

          <section className="table-card">
            <SectionTitle title="أنواع طلبات السكن" />
            <div className="table-scroll">
              <table className="compact-table">
                <thead><tr><th>النوع</th><th>العدد</th><th>الحالة</th></tr></thead>
                <tbody>
                  {requests.housingRequests.byType.map((row) => (
                    <tr key={row.label}>
                      <td><strong>{row.label}</strong></td>
                      <td>{formatNumber(row.total)}</td>
                      <td><Badge tone="info">مسجّل</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!requests.housingRequests.byType.length && <EmptyState title="لا توجد طلبات سكن" />}
            </div>
          </section>
        </>
      )}

      {/* -------------------------------- الدوام ------------------------------ */}
      {tab === "duty" && duty && (
        <>
          <div className="stats-grid stats-grid-4">
            <StatCard icon={CalendarCheck} label="بجدول دوام" value={formatNumber(duty.summary.withSchedule || 0)} hint={`من ${formatNumber(model.residents.length)} ساكن`} />
            <StatCard icon={CalendarCheck} label="مداومون" value={formatNumber(duty.summary.onDuty || 0)} tone="success" />
            <StatCard icon={CalendarCheck} label="في إجازة" value={formatNumber(duty.summary.onLeave || 0)} tone="warn" />
            <StatCard icon={CalendarCheck} label="بدون جدول" value={formatNumber(duty.summary.withoutSchedule || 0)} tone="muted" />
          </div>

          <div className="dash-grid">
            <section className="chart-card">
              <SectionTitle title="توزيع الدوام" hint={formatDate(duty.date)} />
              <DonutChart
                data={[
                  { label: "مداوم", value: duty.summary.onDuty || 0, color: "#0f9d68" },
                  { label: "إجازة", value: duty.summary.onLeave || 0, color: "#e6a700" },
                  { label: "بدون جدول", value: duty.summary.withoutSchedule || 0, color: "#9aa7b6" },
                ].filter((slice) => slice.value > 0)}
                centerLabel="ساكن"
                size={190}
              />
            </section>
            <section className="chart-card">
              <SectionTitle title="السجل حسب الشركة" />
              <BarList
                data={Array.from(
                  duty.rows.reduce((map, row) => {
                    const key = row.company || "غير محدد";
                    map.set(key, (map.get(key) || 0) + 1);
                    return map;
                  }, new Map<string, number>()),
                ).map(([label, value]) => ({ label, value }))}
              />
            </section>
          </div>

          <section className="table-card">
            <SectionTitle title="جدول الدوام" hint={`${formatNumber(duty.rows.length)} سجل`} />
            <div className="table-scroll">
              <table className="residents-table">
                <thead>
                  <tr><th>الاسم</th><th>الرقم الوظيفي</th><th>الشركة</th><th>المبنى / الغرفة</th><th>الوردية</th><th>الدورة</th><th>الحالة</th></tr>
                </thead>
                <tbody>
                  {duty.rows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name}</strong><small className="block-note">{row.department || "—"}</small></td>
                      <td>{row.employeeCode || "—"}</td>
                      <td>{row.company || "—"}</td>
                      <td>{row.building || "—"}{row.room ? ` / ${row.room}` : ""}</td>
                      <td>{row.shift || "—"}</td>
                      <td>{formatNumber(row.workDays)} عمل / {formatNumber(row.restDays)} راحة</td>
                      <td><Badge tone={statusTone(row.status)}>{row.status || "—"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!duty.rows.length && <EmptyState title="لا توجد جداول دوام" hint="حدّد دورة الدوام من ملف الساكن" />}
            </div>
          </section>
        </>
      )}
    </>
  );
}
