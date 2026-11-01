"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  DoorOpen,
  Eye,
  FilePlus2,
  Filter,
  Home,
  Plus,
  Printer,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  UserRoundPlus,
  XCircle,
} from "lucide-react";
import {
  approveContractorRequest,
  createContractorRequest,
  createHousingRequest,
  deleteHousingRequest,
  listContractorFreeBeds,
  listContractorRequests,
  listHousingRequests,
  rejectContractorRequest,
  setHousingRequestStatus,
} from "@/lib/api";
import { HOUSING_REQUEST_TYPE_LABELS, formatDate, formatDateTime, formatNumber, requestTypeLabel, stageLabel, statusTone, timeAgo } from "@/lib/format";
import { printOfficialRequestForm } from "@/lib/officialForm";
import { routePath } from "@/lib/nav";
import { can, canAny } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { ContractorRequest, HousingRequest } from "@/lib/types";
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
  Pagination,
  SearchInput,
  Select,
  StatCard,
  Tabs,
  TextArea,
  TextInput,
} from "@/components/ui";

type TabId = "contractor" | "housing";
type StageFilter = "" | "pending" | "department" | "housing" | "security" | "visitor" | "done" | "rejected";

const STAGE_TABS: Array<{ id: StageFilter; label: string }> = [
  { id: "pending", label: "المعلّقة" },
  { id: "department", label: "اعتماد الإدارة" },
  { id: "security", label: "الاعتماد الأمني" },
  { id: "visitor", label: "اعتماد الزوار" },
  { id: "housing", label: "اعتماد السكن" },
  { id: "done", label: "مكتملة" },
  { id: "rejected", label: "المستبعدون/المرفوضة" },
  { id: "", label: "الكل" },
];

const STAGE_PERMISSION: Record<string, string> = {
  department: "requests.department",
  housing: "requests.supervise",
  security: "requests.security",
  visitor: "requests.visitor",
};

const HOUSING_TYPES = ["تسكين جديد", "نقل سرير", "إخلاء سكن", "صيانة غرفة", "تمديد سكن", "طلب زيارة", "أخرى"];
const HOUSING_STATUSES = ["قيد المراجعة", "معتمد", "قيد التنفيذ", "مكتمل", "مرفوض"];

const EMPTY_CONTRACTOR_REQUEST = {
  contractorId: "",
  requestType: "new_worker",
  workerName: "",
  employeeCode: "",
  jobTitle: "",
  workerCardNumber: "",
  workerBirthDate: "",
  workerBirthPlace: "",
  reason: "",
};

const EMPTY_HOUSING_REQUEST = {
  residentId: "",
  residentName: "",
  requestType: "تسكين جديد",
  priority: "عادي",
  details: "",
};

export default function RequestsPage() {
  const { data, user, offline, reload } = useApp();
  const [tab, setTab] = useState<TabId>("contractor");

  const [stage, setStage] = useState<StageFilter>("pending");
  const [contractorQuery, setContractorQuery] = useState("");
  const [contractorFilter, setContractorFilter] = useState("");
  const [requestTypeFilter, setRequestTypeFilter] = useState("");
  const [contractorRows, setContractorRows] = useState<ContractorRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [contractorLoading, setContractorLoading] = useState(false);

  const [housingStatus, setHousingStatus] = useState("");
  const [housingType, setHousingType] = useState("");
  const [housingQuery, setHousingQuery] = useState("");
  const [housingPage, setHousingPage] = useState(1);
  const [housingRows, setHousingRows] = useState<HousingRequest[]>([]);
  const [housingTotal, setHousingTotal] = useState(0);
  const [housingSummary, setHousingSummary] = useState({ total: 0, pending: 0 });
  const [housingLoading, setHousingLoading] = useState(false);

  const [detail, setDetail] = useState<ContractorRequest | null>(null);
  const [approveTarget, setApproveTarget] = useState<ContractorRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ContractorRequest | null>(null);
  const [employeeCode, setEmployeeCode] = useState("");
  const [selectedBedId, setSelectedBedId] = useState("");
  const [freeBeds, setFreeBeds] = useState<Array<{ id: string; label: string; roomName: string; buildingName: string }>>([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionError, setActionError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState({ ...EMPTY_CONTRACTOR_REQUEST });
  const [createError, setCreateError] = useState("");

  const [housingOpen, setHousingOpen] = useState(false);
  const [housingDraft, setHousingDraft] = useState({ ...EMPTY_HOUSING_REQUEST });
  const [housingFormError, setHousingFormError] = useState("");
  const [housingTarget, setHousingTarget] = useState<HousingRequest | null>(null);
  const [housingStatusValue, setHousingStatusValue] = useState("قيد المراجعة");
  const [housingNotes, setHousingNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const canCreateContractor = canAny(user, ["contractors.manage", "housing.manage"]);
  const canManageHousing = can(user, "residents.manage");
  const canChangeHousing = can(user, "requests.supervise");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "housing") setTab("housing");
    const requested = params.get("stage");
    if (requested && ["pending", "department", "housing", "security", "visitor", "done", "rejected"].includes(requested)) {
      setStage(requested as StageFilter);
    }
    if (params.get("action") === "add" && canCreateContractor) setCreateOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadContractor = useCallback(async () => {
    if (!data) return;
    setContractorLoading(true);
    setError("");
    try {
      const result = await listContractorRequests({
        stage,
        contractorId: contractorFilter,
        requestType: requestTypeFilter,
        q: contractorQuery,
        page: 1,
        pageSize: 300,
      });
      setContractorRows(result.items || []);
      setCounts(result.counts || {});
    } catch (err) {
      if (offline) {
        const rows = (data.contractorRequests || []).filter((request) => {
          if (stage === "pending" && !request.isPending) return false;
          if (stage && stage !== "pending" && request.stage !== stage) return false;
          if (contractorFilter && request.contractorId !== contractorFilter) return false;
          if (requestTypeFilter && request.requestType !== requestTypeFilter) return false;
          const needle = contractorQuery.trim().toLowerCase();
          if (!needle) return true;
          return [request.workerName, request.workerCardNumber, request.employeeCode, request.contractorName].join(" ").toLowerCase().includes(needle);
        });
        setContractorRows(rows);
        setCounts(data.meta?.pendingCounts || {});
      } else {
        setError(err instanceof Error ? err.message : "تعذر تحميل طلبات المتعهدين");
      }
    } finally {
      setContractorLoading(false);
    }
  }, [data, stage, contractorFilter, requestTypeFilter, contractorQuery, offline]);

  const loadHousing = useCallback(async () => {
    if (!data) return;
    setHousingLoading(true);
    setError("");
    try {
      const result = await listHousingRequests({
        status: housingStatus,
        requestType: housingType,
        q: housingQuery,
        page: housingPage,
        pageSize: 25,
      });
      setHousingRows(result.items || []);
      setHousingTotal(result.total || 0);
      setHousingSummary(result.summary || { total: 0, pending: 0 });
    } catch (err) {
      if (offline) {
        const rows = (data.requests || []).filter((request) => {
          if (housingStatus && request.status !== housingStatus) return false;
          if (housingType && request.requestType !== housingType) return false;
          const needle = housingQuery.trim().toLowerCase();
          if (!needle) return true;
          return [request.residentName, request.employeeCode, request.details, request.requestType, request.createdBy].join(" ").toLowerCase().includes(needle);
        });
        setHousingRows(rows);
        setHousingTotal(rows.length);
        setHousingSummary({
          total: (data.requests || []).length,
          pending: (data.requests || []).filter((request) => request.status === "قيد المراجعة").length,
        });
      } else {
        setError(err instanceof Error ? err.message : "تعذر تحميل طلبات السكن");
      }
    } finally {
      setHousingLoading(false);
    }
  }, [data, housingStatus, housingType, housingQuery, housingPage, offline]);

  useEffect(() => {
    if (tab === "contractor") loadContractor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, stage, contractorFilter, requestTypeFilter]);

  useEffect(() => {
    if (tab === "housing") loadHousing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, housingStatus, housingType, housingPage]);

  const contractorOptions = useMemo(
    () => (data?.contractors || []).map((contractor) => ({ value: contractor.id, label: contractor.name })),
    [data],
  );

  const selectedContractorWorkers = useMemo(() => {
    if (!createDraft.contractorId) return [];
    return (data?.residents || []).filter((resident) => resident.contractorId === createDraft.contractorId);
  }, [data, createDraft.contractorId]);

  const pendingTotal = (counts.total ?? data?.meta?.pendingCounts?.total ?? 0) || 0;

  function notify(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 5000);
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "تعذر تنفيذ الإجراء");
  }

  function canApprove(request: ContractorRequest): boolean {
    if (!request.isPending && ![ "department", "housing", "security", "visitor" ].includes(request.stage)) return false;
    if (["done", "rejected"].includes(request.stage)) return false;
    const permission = STAGE_PERMISSION[request.stage];
    return !!permission && can(user, permission);
  }

  function openApprove(request: ContractorRequest) {
    setApproveTarget(request);
    setEmployeeCode(request.employeeCode || "");
    setSelectedBedId(request.bedId || "");
    setFreeBeds([]);
    setReviewNotes("");
    setActionError("");
    if (request.stage === "housing" && request.requestType === "new_worker" && request.contractorId) {
      setBedsLoading(true);
      listContractorFreeBeds(request.contractorId)
        .then((result) => {
          setFreeBeds(result.items || []);
          if (result.items?.length && !request.bedId) setSelectedBedId("");
        })
        .catch((err) => setActionError(err instanceof Error ? err.message : "تعذر تحميل الأسرّة المتاحة"))
        .finally(() => setBedsLoading(false));
    }
  }

  async function confirmApprove() {
    if (!approveTarget) return;
    const target = approveTarget;
    if (target.stage === "visitor" && target.requestType === "new_worker" && !employeeCode.trim()) {
      setActionError("كود الموظف مطلوب في مرحلة اعتماد الزوار");
      return;
    }
    if (target.stage === "housing" && target.requestType === "new_worker" && !selectedBedId) {
      setActionError("يرجى تحديد الغرفة ورقم السرير قبل الاعتماد");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await approveContractorRequest(target.id, target.stage, {
        employeeCode: employeeCode.trim() || undefined,
        notes: reviewNotes.trim(),
        bedId: target.stage === "housing" ? selectedBedId : undefined,
      });
      setApproveTarget(null);
      setDetail(null);
      await reload();
      await loadContractor();
      notify(`تم اعتماد مرحلة ${stageLabel(target.stage)} للطلب`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذر اعتماد الطلب");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    setBusy(true);
    setActionError("");
    try {
      await rejectContractorRequest(rejectTarget.id, reviewNotes.trim());
      setRejectTarget(null);
      setDetail(null);
      await reload();
      await loadContractor();
      notify("تم رفض الطلب");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذر رفض الطلب");
    } finally {
      setBusy(false);
    }
  }

  async function submitContractorRequest() {
    if (!createDraft.contractorId) {
      setCreateError("اختر المتعهد/المقاول");
      return;
    }
    if (!createDraft.workerName.trim()) {
      setCreateError("اسم العامل مطلوب");
      return;
    }
    setBusy(true);
    setCreateError("");
    try {
      await createContractorRequest({
        contractorId: createDraft.contractorId,
        requestType: createDraft.requestType,
        workerName: createDraft.workerName.trim(),
        employeeCode: createDraft.employeeCode.trim() || undefined,
        jobTitle: createDraft.jobTitle.trim() || undefined,
        workerCardNumber: createDraft.workerCardNumber.trim() || undefined,
        workerBirthDate: createDraft.workerBirthDate || undefined,
        workerBirthPlace: createDraft.workerBirthPlace.trim() || undefined,
        reason: createDraft.reason.trim() || undefined,
      });
      setCreateOpen(false);
      setCreateDraft({ ...EMPTY_CONTRACTOR_REQUEST });
      await reload();
      await loadContractor();
      notify("تم إنشاء طلب المتعهد وإرساله للاعتماد");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "تعذر إنشاء الطلب");
    } finally {
      setBusy(false);
    }
  }

  async function submitHousingRequest() {
    if (!housingDraft.residentName.trim() && !housingDraft.residentId) {
      setHousingFormError("اختر الساكن أو اكتب الاسم");
      return;
    }
    if (!housingDraft.details.trim()) {
      setHousingFormError("تفاصيل الطلب مطلوبة");
      return;
    }
    setBusy(true);
    setHousingFormError("");
    try {
      await createHousingRequest({
        residentId: housingDraft.residentId || undefined,
        residentName: housingDraft.residentName.trim(),
        requestType: housingDraft.requestType,
        priority: housingDraft.priority,
        details: housingDraft.details.trim(),
      });
      setHousingOpen(false);
      setHousingDraft({ ...EMPTY_HOUSING_REQUEST });
      await reload();
      await loadHousing();
      notify("تم إنشاء طلب السكن");
    } catch (err) {
      setHousingFormError(err instanceof Error ? err.message : "تعذر إنشاء الطلب");
    } finally {
      setBusy(false);
    }
  }

  async function saveHousingStatus() {
    if (!housingTarget) return;
    setBusy(true);
    try {
      await setHousingRequestStatus(housingTarget.id, housingStatusValue, housingNotes.trim());
      setHousingTarget(null);
      await reload();
      await loadHousing();
      notify("تم تحديث حالة طلب السكن");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeHousingRequest(request: HousingRequest) {
    if (!window.confirm(`حذف طلب ${request.residentName}؟`)) return;
    setBusy(true);
    try {
      await deleteHousingRequest(request.id);
      await reload();
      await loadHousing();
      notify("تم حذف الطلب");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function stageCount(id: StageFilter): number | undefined {
    if (id === "pending") return counts.total;
    if (id === "") return undefined;
    return counts[id];
  }

  if (!data) return <Loader label="جارٍ تحميل الطلبات..." />;

  return (
    <>
      <PageHead
        eyebrow="الطلبات"
        title="الطلبات والاعتمادات"
        subtitle={`${formatNumber(pendingTotal)} طلب متعهد معلّق · ${formatNumber(housingSummary.pending)} طلب سكن قيد المراجعة`}
        actions={
          <div className="head-actions">
            <button type="button" className="secondary-btn" onClick={() => (tab === "contractor" ? loadContractor() : loadHousing())} disabled={contractorLoading || housingLoading}>
              <RefreshCw size={16} /> تحديث
            </button>
            {tab === "contractor" && canCreateContractor && (
              <button type="button" className="primary-btn" onClick={() => { setCreateDraft({ ...EMPTY_CONTRACTOR_REQUEST }); setCreateError(""); setCreateOpen(true); }} disabled={offline}>
                <UserRoundPlus size={16} /> طلب متعهد
              </button>
            )}
            {tab === "housing" && canManageHousing && (
              <button type="button" className="primary-btn" onClick={() => { setHousingDraft({ ...EMPTY_HOUSING_REQUEST }); setHousingFormError(""); setHousingOpen(true); }} disabled={offline}>
                <FilePlus2 size={16} /> طلب سكن
              </button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {offline && <Alert tone="warning">وضع دون إنترنت: عرض فقط — لا يمكن اعتماد أو إنشاء الطلبات.</Alert>}

      <div className="stats-grid stats-grid-4">
        <StatCard icon={Clock3} label="معلّقة" value={formatNumber(pendingTotal)} hint="بانتظار اعتماد" tone="warn" />
        <StatCard icon={UserRoundPlus} label="اعتماد الإدارة" value={formatNumber(counts.department || 0)} tone="warn" />
        <StatCard icon={ShieldCheck} label="الاعتماد الأمني" value={formatNumber(counts.security || 0)} tone="primary" />
        <StatCard icon={CheckCircle2} label="مكتملة" value={formatNumber(counts.done || 0)} hint={`${formatNumber(counts.rejected || 0)} مرفوضة`} tone="success" />
      </div>

      <Tabs
        tabs={[
          { id: "contractor", label: "طلبات المتعهدين", count: pendingTotal },
          { id: "housing", label: "طلبات السكن", count: housingSummary.pending },
        ]}
        active={tab}
        onChange={(id) => setTab(id)}
      />

      {tab === "contractor" && (
        <>
          <section className="form-panel filters-panel">
            <div className="filters-row">
              <SearchInput value={contractorQuery} onChange={setContractorQuery} onSubmit={loadContractor} placeholder="بحث باسم العامل أو البطاقة أو المتعهد..." />
              <Select value={contractorFilter} onChange={(event) => setContractorFilter(event.target.value)} placeholder="كل المتعهدين" options={contractorOptions} />
              <Select
                value={requestTypeFilter}
                onChange={(event) => setRequestTypeFilter(event.target.value)}
                placeholder="كل الأنواع"
                options={[
                  { value: "new_worker", label: "إضافة عامل" },
                  { value: "remove_worker", label: "استبعاد عامل" },
                ]}
              />
              <button type="button" className="secondary-btn" onClick={loadContractor} disabled={contractorLoading}>
                <Filter size={16} /> تطبيق
              </button>
            </div>
            <div className="stage-tabs">
              {STAGE_TABS.map((item) => (
                <button
                  key={item.id || "all"}
                  type="button"
                  className={stage === item.id ? "active" : ""}
                  onClick={() => setStage(item.id)}
                >
                  {item.label}
                  {typeof stageCount(item.id) === "number" && <span>{formatNumber(stageCount(item.id))}</span>}
                </button>
              ))}
            </div>
          </section>

          <section className="table-card">
            {contractorLoading ? (
              <Loader label="جارٍ تحميل الطلبات..." />
            ) : contractorRows.length ? (
              <div className="table-scroll">
                <table className="residents-table">
                  <thead>
                    <tr>
                      <th>العامل</th>
                      <th>المتعهد</th>
                      <th>النوع</th>
                      <th>المرحلة</th>
                      <th>العمر</th>
                      <th>أنشئ</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractorRows.map((request) => (
                      <tr key={request.id}>
                        <td>
                          <div className="stack-cell">
                            <strong>{request.workerName}</strong>
                            <small>{request.workerCardNumber || request.employeeCode || request.jobTitle || "—"}</small>
                            {stage === "rejected" && request.reviewNotes && <small className="block-note">السبب: {request.reviewNotes}</small>}
                          </div>
                        </td>
                        <td>{request.contractorName}</td>
                        <td><Badge tone={request.requestType === "new_worker" ? "info" : "warn"}>{request.typeLabel || requestTypeLabel(request.requestType)}</Badge></td>
                        <td><Badge tone={statusTone(request.stage)} dot>{request.stageLabel || stageLabel(request.stage)}</Badge></td>
                        <td>{request.workerAge ? `${formatNumber(request.workerAge)} سنة` : "—"}</td>
                        <td>{timeAgo(request.createdAt)}</td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="icon-plain" title="تفاصيل" onClick={() => setDetail(request)}>
                              <Eye size={16} />
                            </button>
                            {canApprove(request) && (
                              <>
                                <button type="button" className="secondary-btn small-btn" onClick={() => openApprove(request)} disabled={offline}>
                                  <CheckCircle2 size={14} /> اعتماد
                                </button>
                                <button type="button" className="danger-btn small-btn" onClick={() => { setRejectTarget(request); setReviewNotes(""); setActionError(""); }} disabled={offline}>
                                  <XCircle size={14} /> رفض
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="لا توجد طلبات في هذه المرحلة"
                hint={canCreateContractor ? "أنشئ طلباً جديداً أو اختر مرحلة أخرى" : "اختر مرحلة أخرى من التبويبات"}
                action={canCreateContractor && !offline ? <button type="button" className="primary-btn" onClick={() => setCreateOpen(true)}><Plus size={16} /> طلب متعهد</button> : undefined}
              />
            )}
          </section>
        </>
      )}

      {tab === "housing" && (
        <>
          <section className="form-panel filters-panel">
            <div className="filters-row">
              <SearchInput value={housingQuery} onChange={setHousingQuery} onSubmit={() => { setHousingPage(1); loadHousing(); }} placeholder="بحث باسم الساكن أو التفاصيل..." />
              <Select value={housingStatus} onChange={(event) => { setHousingStatus(event.target.value); setHousingPage(1); }} placeholder="كل الحالات" options={HOUSING_STATUSES.map((status) => ({ value: status, label: status }))} />
              <Select value={housingType} onChange={(event) => { setHousingType(event.target.value); setHousingPage(1); }} placeholder="كل الأنواع" options={HOUSING_TYPES.map((type) => ({ value: type, label: type }))} />
              <button type="button" className="secondary-btn" onClick={() => { setHousingPage(1); loadHousing(); }} disabled={housingLoading}>
                <Filter size={16} /> تطبيق
              </button>
            </div>
            <div className="filters-foot">
              <span>النتائج: <strong>{formatNumber(housingTotal)}</strong> من {formatNumber(housingSummary.total)}</span>
            </div>
          </section>

          <section className="table-card">
            {housingLoading ? (
              <Loader label="جارٍ تحميل طلبات السكن..." />
            ) : housingRows.length ? (
              <div className="table-scroll">
                <table className="residents-table">
                  <thead>
                    <tr>
                      <th>النوع</th>
                      <th>الساكن</th>
                      <th>التفاصيل</th>
                      <th>الأولوية</th>
                      <th>الحالة</th>
                      <th>التاريخ</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {housingRows.map((request) => (
                      <tr key={request.id}>
                        <td><strong>{HOUSING_REQUEST_TYPE_LABELS[request.requestType] || request.requestType}</strong></td>
                        <td>
                          <div className="stack-cell">
                            <strong>{request.residentName}</strong>
                            <small>{request.employeeCode || request.createdBy || "—"}</small>
                          </div>
                        </td>
                        <td className="wrap-cell">{request.details}</td>
                        <td><Badge tone={request.priority === "عاجل" ? "bad" : request.priority === "مهم" ? "warn" : "muted"}>{request.priority || "عادي"}</Badge></td>
                        <td><Badge tone={statusTone(request.status)} dot>{request.status}</Badge></td>
                        <td>{formatDateTime(request.createdAt)}</td>
                        <td>
                          <div className="row-actions">
                            {request.residentId && (
                              <a className="icon-plain" title="ملف الساكن" href={routePath(`/residents?highlight=${encodeURIComponent(request.residentId)}`)}>
                                <UserRound size={16} />
                              </a>
                            )}
                            {canChangeHousing && (
                              <>
                                <button
                                  type="button"
                                  className="secondary-btn small-btn"
                                  onClick={() => {
                                    setHousingTarget(request);
                                    setHousingStatusValue(request.status);
                                    setHousingNotes(request.reviewNotes || "");
                                  }}
                                  disabled={offline}
                                >
                                  <ClipboardList size={14} /> الحالة
                                </button>
                                <button type="button" className="icon-plain danger" title="حذف" onClick={() => removeHousingRequest(request)} disabled={offline || busy}>
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="لا توجد طلبات سكن"
                hint={canManageHousing ? "أنشئ طلب سكن جديد لساكن أو لصيانة غرفة" : "لا توجد طلبات مطابقة للفلاتر"}
                action={canManageHousing && !offline ? <button type="button" className="primary-btn" onClick={() => setHousingOpen(true)}><FilePlus2 size={16} /> طلب سكن</button> : undefined}
              />
            )}
          </section>
          <Pagination page={housingPage} pages={Math.max(1, Math.ceil(housingTotal / 25))} total={housingTotal} onPage={setHousingPage} />
        </>
      )}

      {/* --------------------------- تفاصيل طلب المتعهد --------------------------- */}
      <Modal open={!!detail} title="تفاصيل طلب المتعهد" subtitle={detail ? `${detail.workerName} — ${detail.contractorName}` : undefined} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="stack-lg">
            <InfoGrid
              items={[
                { label: "رقم الطلب", value: detail.id },
                { label: "نوع الطلب", value: detail.typeLabel || requestTypeLabel(detail.requestType) },
                { label: "المرحلة", value: <Badge tone={statusTone(detail.stage)}>{detail.stageLabel || stageLabel(detail.stage)}</Badge> },
                { label: "إدارة المتعهد", value: detail.contractor?.department || "—" },
                { label: "رقم البطاقة", value: detail.workerCardNumber || "—" },
                { label: "كود الموظف", value: detail.employeeCode || "—" },
                { label: "المسمى", value: detail.jobTitle || "—" },
                { label: "تاريخ الميلاد", value: detail.workerBirthDate ? formatDate(detail.workerBirthDate) : "—" },
                { label: "مكان الميلاد", value: detail.workerBirthPlace || "—" },
                { label: "السرير", value: detail.bedLabel ? `${detail.bedLabel} ${detail.roomName ? `· ${detail.roomName}` : ""}` : "—" },
                { label: "أنشئ بواسطة", value: detail.submittedBy || "—" },
                { label: "تاريخ الإنشاء", value: formatDateTime(detail.createdAt) },
                { label: "آخر مراجعة", value: detail.reviewedAt ? formatDateTime(detail.reviewedAt) : "—" },
              ]}
            />
            {detail.reason && <Alert tone="info">سبب الطلب: {detail.reason}</Alert>}
            {detail.formNo && <p className="muted">رقم النموذج الرسمي للطلب: <b>{detail.formNo}</b></p>}
            {Array.isArray(detail.previousExclusions) && detail.previousExclusions.length > 0 && (
              <Alert tone="warning">
                <strong>نذير: كان للعامل استبعادات سابقة:</strong>
                <ul style={{ margin: "6px 0 0", paddingRight: 16 }}>
                  {detail.previousExclusions.map((exclusion, index) => (
                    <li key={`${exclusion.at}-${index}`}>
                      {exclusion.contractor || "متعهد"} · {exclusion.at ? formatDate(exclusion.at) : "تاريخ غير محدد"} · السبب: {exclusion.reason}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {detail.reviewNotes && <Alert tone={detail.stage === "rejected" ? "danger" : "success"}>ملاحظات المراجعة: {detail.reviewNotes}</Alert>}

            <div>
              <h3 className="sub-title">مسار الاعتماد</h3>
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
                        <span>{passed ? <CheckCircle2 size={15} /> : step === "done" ? <CheckCircle2 size={15} /> : step === "housing" ? <Home size={15} /> : step === "security" ? <ShieldCheck size={15} /> : <DoorOpen size={15} />}</span>
                        <small>{stageLabel(step)}</small>
                      </div>
                    );
                  });
                })()}
              </div>
              {detail.stage === "rejected" && <Alert tone="danger">تم رفض الطلب — راجع ملاحظات المراجعة أعلاه.</Alert>}
            </div>

            <div>
              <h3 className="sub-title">سجل الإجراءات</h3>
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
              ) : (
                <p className="muted">لا يوجد سجل إجراءات بعد.</p>
              )}
            </div>

            {canApprove(detail) && (
              <div className="row-actions">
                <button type="button" className="primary-btn" onClick={() => openApprove(detail)} disabled={offline}>
                  <CheckCircle2 size={16} /> اعتماد {stageLabel(detail.stage)}
                </button>
                <button type="button" className="danger-btn" onClick={() => { setRejectTarget(detail); setReviewNotes(""); setActionError(""); }} disabled={offline}>
                  <XCircle size={16} /> رفض
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* -------------------------------- اعتماد -------------------------------- */}
      <Modal
        open={!!approveTarget}
        title={`اعتماد ${approveTarget ? stageLabel(approveTarget.stage) : ""}`}
        subtitle={approveTarget ? `${approveTarget.workerName} — ${approveTarget.contractorName}` : undefined}
        onClose={() => setApproveTarget(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setApproveTarget(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={confirmApprove} disabled={busy || offline}>
              <CheckCircle2 size={16} /> {busy ? "جارٍ الاعتماد..." : "تأكيد الاعتماد"}
            </button>
          </>
        }
      >
        {approveTarget && (
          <div className="stack-lg">
            <InfoGrid
              items={[
                { label: "العامل", value: approveTarget.workerName },
                { label: "النوع", value: approveTarget.typeLabel || requestTypeLabel(approveTarget.requestType) },
                { label: "المرحلة الحالية", value: approveTarget.stageLabel || stageLabel(approveTarget.stage) },
                { label: "المتعهد", value: approveTarget.contractorName },
              ]}
            />
            {approveTarget.stage === "housing" && approveTarget.requestType === "new_worker" && (
              <Field
                label="تحديد السكن — الغرفة والسرير"
                required
                hint="اختر سريراً من الأسرّة المتاحة للمتعهد — تظهر البيانات لدى المتعهد بعد الاعتماد"
              >
                {bedsLoading ? (
                  <p className="muted">جارٍ تحميل الأسرّة المتاحة...</p>
                ) : freeBeds.length ? (
                  <Select
                    value={selectedBedId}
                    onChange={(event) => setSelectedBedId(event.target.value)}
                    placeholder="اختر الغرفة ورقم السرير..."
                    options={freeBeds.map((bed) => ({
                      value: bed.id,
                      label: `${bed.buildingName ? `${bed.buildingName} · ` : ""}${bed.roomName || "غرفة"} — سرير ${bed.label}`.trim(),
                    }))}
                  />
                ) : (
                  <Alert tone="warning">لا توجد أسرّة متاحة حالياً لدى هذا المتعهد.</Alert>
                )}
              </Field>
            )}
            {approveTarget.stage === "visitor" && approveTarget.requestType === "remove_worker" && (
              <Alert tone="warning">سيتم استبعاد العامل وإخلاء سريره عند اعتماد هذه المرحلة.</Alert>
            )}
            {approveTarget.stage === "visitor" && approveTarget.requestType === "new_worker" && (
              <Field
                label="كود الموظف"
                required
                hint="مطلوب عند مراقب الزوار قبل تمرير الطلب لمشرف السكن"
              >
                <TextInput value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} placeholder="مثال: EMP-1024" />
              </Field>
            )}
            <Field label="ملاحظات (اختياري)">
              <TextArea rows={3} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} />
            </Field>
            {actionError && <Alert tone="danger">{actionError}</Alert>}
          </div>
        )}
      </Modal>

      {/* --------------------------------- رفض ---------------------------------- */}
      <Modal
        open={!!rejectTarget}
        title="رفض الطلب"
        subtitle={rejectTarget ? `${rejectTarget.workerName} — ${rejectTarget.contractorName}` : undefined}
        onClose={() => setRejectTarget(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setRejectTarget(null)}>إلغاء</button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => rejectTarget && printOfficialRequestForm(rejectTarget)}
              disabled={!rejectTarget}
            >
              <Printer size={16} /> نموذج رسمي
            </button>
            <button type="button" className="danger-btn" onClick={confirmReject} disabled={busy || offline}>
              <XCircle size={16} /> {busy ? "جارٍ الرفض..." : "تأكيد الرفض"}
            </button>
          </>
        }
      >
        <div className="stack-lg">
          <Alert tone="warning">سيُغلق الطلب نهائياً ويُبلغ المتعهد بسبب الرفض.</Alert>
          <Field label="سبب الرفض" required>
            <TextArea rows={3} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="اكتب سبب الرفض..." />
          </Field>
          {actionError && <Alert tone="danger">{actionError}</Alert>}
        </div>
      </Modal>

      {/* ----------------------------- طلب متعهد جديد ---------------------------- */}
      <Modal
        open={createOpen}
        title="طلب متعهد جديد"
        subtitle="إضافة عامل جديد أو استبعاد عامل قائم"
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setCreateOpen(false)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={submitContractorRequest} disabled={busy || offline}>
              <UserRoundPlus size={16} /> {busy ? "جارٍ الإرسال..." : "إرسال الطلب"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="المتعهد" required>
            <Select
              value={createDraft.contractorId}
              onChange={(event) => setCreateDraft({ ...createDraft, contractorId: event.target.value })}
              placeholder="اختر المتعهد..."
              options={contractorOptions}
            />
          </Field>
          <Field label="نوع الطلب" required>
            <Select
              value={createDraft.requestType}
              onChange={(event) => setCreateDraft({ ...createDraft, requestType: event.target.value, workerName: "", employeeCode: "", workerCardNumber: "", workerBirthDate: "", workerBirthPlace: "" })}
              options={[
                { value: "new_worker", label: "إضافة عامل" },
                { value: "remove_worker", label: "استبعاد عامل" },
              ]}
            />
          </Field>

          {createDraft.requestType === "remove_worker" && (
            <Field label="اختر العامل من عمالة المتعهد" className="full">
              <Select
                value=""
                onChange={(event) => {
                  const resident = selectedContractorWorkers.find((item) => item.id === event.target.value);
                  if (!resident) return;
                  setCreateDraft({
                    ...createDraft,
                    workerName: resident.name,
                    employeeCode: resident.employeeCode || "",
                    workerCardNumber: resident.cardNumber || "",
                    jobTitle: resident.jobTitle || "",
                  });
                }}
                placeholder={selectedContractorWorkers.length ? "اختر عاملاً..." : "لا يوجد عمال لهذا المتعهد"}
                options={selectedContractorWorkers.map((resident) => ({
                  value: resident.id,
                  label: `${resident.name}${resident.employeeCode ? ` — ${resident.employeeCode}` : ""}`,
                }))}
              />
            </Field>
          )}

          <Field label="اسم العامل" required>
            <TextInput value={createDraft.workerName} onChange={(event) => setCreateDraft({ ...createDraft, workerName: event.target.value })} />
          </Field>
          <Field label="كود الموظف" hint="يمكن إدخاله لاحقاً في مرحلة الاعتماد">
            <TextInput value={createDraft.employeeCode} onChange={(event) => setCreateDraft({ ...createDraft, employeeCode: event.target.value })} />
          </Field>
          <Field label="المسمى الوظيفي">
            <TextInput value={createDraft.jobTitle} onChange={(event) => setCreateDraft({ ...createDraft, jobTitle: event.target.value })} />
          </Field>
          <Field label="رقم البطاقة" required={createDraft.requestType === "new_worker"}>
            <TextInput value={createDraft.workerCardNumber} onChange={(event) => setCreateDraft({ ...createDraft, workerCardNumber: event.target.value })} />
          </Field>
          <Field label="تاريخ الميلاد" required={createDraft.requestType === "new_worker"} hint="يجب ألا يقل العمر عن 18 عاماً">
            <TextInput type="date" value={createDraft.workerBirthDate} onChange={(event) => setCreateDraft({ ...createDraft, workerBirthDate: event.target.value })} />
          </Field>
          <Field label="مكان الميلاد" required={createDraft.requestType === "new_worker"}>
            <TextInput value={createDraft.workerBirthPlace} onChange={(event) => setCreateDraft({ ...createDraft, workerBirthPlace: event.target.value })} />
          </Field>
          <Field label="سبب الطلب / ملاحظات" className="full">
            <TextArea rows={3} value={createDraft.reason} onChange={(event) => setCreateDraft({ ...createDraft, reason: event.target.value })} />
          </Field>
        </div>
        {createDraft.requestType === "new_worker" && (
          <Alert tone="info">
            يبدأ طلب الإضافة من الاعتماد الأمني ثم الزوار ثم السكن. يتطلب وجود سرير شاغر ضمن سعة المتعهد ومبانيه.
          </Alert>
        )}
        {createDraft.requestType === "remove_worker" && (
          <Alert tone="info">يبدأ طلب الاستبعاد من اعتماد السكن ثم الأمن ثم الزوار، ويُنفّذ الإخلاء في المرحلة الأخيرة.</Alert>
        )}
        {createError && <Alert tone="danger">{createError}</Alert>}
      </Modal>

      {/* ------------------------------ طلب سكن جديد ----------------------------- */}
      <Modal
        open={housingOpen}
        title="طلب سكن جديد"
        subtitle="تسكين أو نقل أو صيانة أو أي طلب سكني"
        onClose={() => setHousingOpen(false)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setHousingOpen(false)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={submitHousingRequest} disabled={busy || offline}>
              <FilePlus2 size={16} /> {busy ? "جارٍ الحفظ..." : "إنشاء الطلب"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="الساكن (اختياري)" className="full">
            <Select
              value={housingDraft.residentId}
              onChange={(event) => {
                const resident = (data.residents || []).find((item) => item.id === event.target.value);
                setHousingDraft({
                  ...housingDraft,
                  residentId: event.target.value,
                  residentName: resident?.name || housingDraft.residentName,
                });
              }}
              placeholder="اختر ساكناً مسجّلاً..."
              options={(data.residents || [])
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, "ar"))
                .map((resident) => ({ value: resident.id, label: `${resident.name}${resident.employeeCode ? ` — ${resident.employeeCode}` : ""}` }))}
            />
          </Field>
          <Field label="اسم مقدم الطلب / الساكن" required>
            <TextInput value={housingDraft.residentName} onChange={(event) => setHousingDraft({ ...housingDraft, residentName: event.target.value })} />
          </Field>
          <Field label="نوع الطلب" required>
            <Select value={housingDraft.requestType} onChange={(event) => setHousingDraft({ ...housingDraft, requestType: event.target.value })} options={HOUSING_TYPES.map((type) => ({ value: type, label: type }))} />
          </Field>
          <Field label="الأولوية">
            <Select
              value={housingDraft.priority}
              onChange={(event) => setHousingDraft({ ...housingDraft, priority: event.target.value })}
              options={[
                { value: "عادي", label: "عادي" },
                { value: "مهم", label: "مهم" },
                { value: "عاجل", label: "عاجل" },
              ]}
            />
          </Field>
          <Field label="تفاصيل الطلب" required className="full">
            <TextArea rows={4} value={housingDraft.details} onChange={(event) => setHousingDraft({ ...housingDraft, details: event.target.value })} placeholder="اكتب تفاصيل واضحة عن الطلب..." />
          </Field>
        </div>
        {housingFormError && <Alert tone="danger">{housingFormError}</Alert>}
      </Modal>

      {/* ------------------------------ حالة طلب السكن ---------------------------- */}
      <Modal
        open={!!housingTarget}
        title="تحديث حالة طلب السكن"
        subtitle={housingTarget ? `${housingTarget.residentName} — ${housingTarget.requestType}` : undefined}
        onClose={() => setHousingTarget(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setHousingTarget(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveHousingStatus} disabled={busy || offline}>حفظ</button>
          </>
        }
      >
        {housingTarget && (
          <div className="stack-lg">
            <InfoGrid
              items={[
                { label: "الطلب", value: housingTarget.id },
                { label: "التفاصيل", value: housingTarget.details },
                { label: "تاريخ الإنشاء", value: formatDateTime(housingTarget.createdAt) },
                { label: "أنشئ بواسطة", value: housingTarget.createdBy || "—" },
              ]}
            />
            <Field label="الحالة الجديدة" required>
              <Select value={housingStatusValue} onChange={(event) => setHousingStatusValue(event.target.value)} options={HOUSING_STATUSES.map((status) => ({ value: status, label: status }))} />
            </Field>
            <Field label="ملاحظات المراجعة">
              <TextArea rows={3} value={housingNotes} onChange={(event) => setHousingNotes(event.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
