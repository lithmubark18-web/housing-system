"use client";

import { useMemo } from "react";
import {
  ArrowUpRight,
  BedDouble,
  Building2,
  ClipboardCheck,
  DoorOpen,
  Handshake,
  Home,
  Hotel,
  ShieldAlert,
  UsersRound,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { BarList, DonutChart } from "@/components/Charts";
import { Badge, EmptyState, Loader, PageHead, Progress, SectionTitle, StatCard, occupancyTone } from "@/components/ui";
import {
  attendanceSummary,
  contractorStageCounts,
  contractorUsage,
  housingResidents,
  monthlyFromRequests,
  occupancySummary,
} from "@/lib/analytics";
import { formatDateTime, formatNumber, formatPercent, statusTone, timeAgo } from "@/lib/format";
import { routePath } from "@/lib/nav";
import { can, roleLabel } from "@/lib/permissions";
import { useApp } from "@/lib/store";

export default function DashboardPage() {
  const { data, user, loading } = useApp();

  const model = useMemo(() => {
    if (!data) return null;
    const residents = housingResidents(data.residents || []);
    const attendance = attendanceSummary(residents);
    const occupancy = occupancySummary(data.tree || [], data.beds || []);
    const contractors = contractorUsage(data.contractors || []);
    const stages = contractorStageCounts(data.contractorRequests || []);
    const pendingStages = stages.filter((stage) => !["done", "rejected"].includes(stage.stage));
    const requestStatuses = new Map<string, number>();
    for (const request of data.requests || []) {
      requestStatuses.set(request.status, (requestStatuses.get(request.status) || 0) + 1);
    }
    return {
      residents,
      attendance,
      occupancy,
      contractors,
      stages,
      pendingStageTotal: pendingStages.reduce((sum, stage) => sum + stage.value, 0),
      requestStatuses,
      monthly: monthlyFromRequests(data.contractorRequests || []),
      buildings: (data.tree || []).slice().sort((a, b) => (b.occupancyPercent || 0) - (a.occupancyPercent || 0)),
      activity: data.auditLog || [],
    };
  }, [data]);

  if (!data || !model) return <Loader label="جارٍ تحميل لوحة المعلومات..." />;

  const totalBeds = data.meta?.counts?.beds || model.occupancy.beds;
  const pendingRequests = data.meta?.pendingCounts?.total || model.pendingStageTotal;

  return (
    <>
      <PageHead
        eyebrow="لوحة المعلومات"
        title={`مرحباً، ${user?.name || "المستخدم"}`}
        subtitle={`${roleLabel(user?.roleId, user?.roleName)} · ${formatDateTime(data.meta?.serverTime)}`}
        actions={
          <div className="head-actions">
            <a className="secondary-btn" href={routePath("/reports")}>
              التقارير <ArrowUpRight size={16} />
            </a>
            {can(user, "residents.manage") && (
              <a className="primary-btn" href={routePath("/residents?action=add")}>
                <UsersRound size={16} /> إضافة ساكن
              </a>
            )}
          </div>
        }
      />

      <div className="stats-grid">
        <StatCard icon={UsersRound} label="السكان في السكن" value={formatNumber(model.residents.length)} hint={`من إجمالي ${formatNumber(data.residents.length)} مسجّل`} />
        <StatCard icon={Building2} label="المباني" value={formatNumber(data.meta?.counts?.buildings || 0)} hint={`${formatNumber(data.meta?.counts?.rooms || 0)} غرفة`} tone="success" />
        <StatCard icon={BedDouble} label="الأسرّة المشغولة" value={`${formatNumber(model.occupancy.occupied)} / ${formatNumber(totalBeds)}`} hint={`${formatPercent(model.occupancy.percent)} إشغال`} tone={occupancyTone(model.occupancy.percent)} />
        <StatCard icon={ShieldAlert} label="طلبات قيد الاعتماد" value={formatNumber(pendingRequests)} hint={`${formatNumber((data.requests || []).filter((r) => r.status === "قيد المراجعة").length)} طلب سكن`} tone="warn" />
        <StatCard icon={UserRoundCheck} label="حاضرون اليوم" value={formatNumber(model.attendance.present)} hint={`${formatPercent(model.residents.length ? (model.attendance.present / model.residents.length) * 100 : 0)} من سكان السكن`} tone="success" />
        <StatCard icon={Hotel} label="في إجازة" value={formatNumber(model.attendance.leave)} hint={`${formatPercent(model.residents.length ? (model.attendance.leave / model.residents.length) * 100 : 0)} من سكان السكن`} tone="warn" />
        <StatCard icon={Home} label="أسرّة شاغرة" value={formatNumber(model.occupancy.free)} hint="جاهزة للتخصيص" tone="primary" />
        <StatCard icon={Handshake} label="المتعهدون النشطون" value={formatNumber(model.contractors.filter((item) => item.status === "active" || item.status === "نشط").length)} hint={`${formatNumber(model.contractors.length)} متعهد مسجّل`} tone="muted" />
      </div>

      <div className="dash-grid">
        <section className="chart-card">
          <SectionTitle title="نسبة الإشغال حسب المبنى" hint={`${model.buildings.length} مبنى`} action={<a className="link-btn" href={routePath("/housing")}>إدارة السكن</a>} />
          {model.buildings.length ? (
            <div className="building-bars">
              {model.buildings.map((building) => (
                <div className="building-bar" key={building.id}>
                  <div className="building-bar-head">
                    <span>
                      <strong>{building.name}</strong>
                      <small>{formatNumber(building.occupiedCount)} / {formatNumber(building.bedCount)} سرير</small>
                    </span>
                    <b className={`pct ${occupancyTone(building.occupancyPercent)}`}>{formatPercent(building.occupancyPercent)}</b>
                  </div>
                  <Progress value={building.occupancyPercent} tone={occupancyTone(building.occupancyPercent)} />
                  <div className="building-bar-foot">
                    <span>{formatNumber(building.roomCount)} غرفة</span>
                    <span>{formatNumber(building.freeCount)} شاغر</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="لا توجد مباني مسجّلة" hint="أضف مبنى من صفحة السكن للبدء" />
          )}
        </section>

        <section className="chart-card">
          <SectionTitle title="حالة سكان السكن اليوم" hint={formatDateTime(data.meta?.serverTime)} />
          <DonutChart
            data={[
              { label: "حاضر", value: model.attendance.present, color: "#0f9d68" },
              { label: "إجازة", value: model.attendance.leave, color: "#e6a700" },
            ].filter((slice) => slice.value > 0)}
            centerLabel="ساكن"
            size={200}
          />
          <div className="attendance-mini">
            <div>
              <span>مخصّص لهم سرير</span>
              <strong>{formatNumber(model.attendance.assigned)}</strong>
            </div>
            <div>
              <span>بدون سرير</span>
              <strong>{formatNumber(model.attendance.unassigned)}</strong>
            </div>
          </div>
        </section>
      </div>

      <section className="section">
        <SectionTitle title="مسار اعتماد طلبات المتعهدين" hint="الطلبات المعلّقة حسب المرحلة" action={<a className="link-btn" href={routePath("/requests")}>فتح الطلبات</a>} />
        <div className="workflow">
          {model.stages.map((stage) => (
            <a key={stage.stage} className={`workflow-step stage-${stage.stage}`} href={routePath(`/requests?stage=${stage.stage}`)}>
              <span className="workflow-icon">
                {stage.stage === "done" ? <UserRoundCheck size={18} /> : stage.stage === "rejected" ? <UserRoundX size={18} /> : stage.stage === "housing" ? <Home size={18} /> : stage.stage === "security" ? <ShieldAlert size={18} /> : <DoorOpen size={18} />}
              </span>
              <span className="workflow-body">
                <small>{stage.label}</small>
                <strong>{formatNumber(stage.value)}</strong>
              </span>
            </a>
          ))}
        </div>
      </section>

      <div className="dash-grid">
        <section className="chart-card">
          <SectionTitle title="استهلاك سعة المتعهدين" hint="أعلى المتعهدين إشغالاً" action={<a className="link-btn" href={routePath("/contractors")}>إدارة</a>} />
          {model.contractors.length ? (
            <div className="table-scroll">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>المتعهد</th>
                    <th>العمال</th>
                    <th>السعة</th>
                    <th>الإشغال</th>
                    <th>معلّق</th>
                  </tr>
                </thead>
                <tbody>
                  {model.contractors.slice(0, 7).map((contractor) => (
                    <tr key={contractor.id}>
                      <td>
                        <div className="stack-cell">
                          <strong>{contractor.name}</strong>
                          <small>{contractor.buildings.slice(0, 2).join("، ") || "بدون مبانٍ"}</small>
                        </div>
                      </td>
                      <td>{formatNumber(contractor.workers)}</td>
                      <td>{formatNumber(contractor.capacity)}</td>
                      <td>
                        <div className="inline-progress">
                          <Progress value={contractor.percent} tone={contractor.percent >= 95 ? "bad" : contractor.percent >= 80 ? "warn" : "good"} />
                          <small>{formatPercent(contractor.percent)}</small>
                        </div>
                      </td>
                      <td>{contractor.pendingRequests ? <Badge tone="warn">{formatNumber(contractor.pendingRequests)}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="لا يوجد متعهدون" />
          )}
        </section>

        <section className="chart-card">
          <SectionTitle title="طلبات المتعهدين الشهرية" hint="آخر 6 أشهر" />
          <div className="month-bars">
            {model.monthly.map((month) => {
              const max = Math.max(...model.monthly.map((item) => item.value), 1);
              return (
                <div key={month.label} className="month-bar">
                  <div className="month-track">
                    <span style={{ height: `${Math.max(6, (month.value / max) * 100)}%` }} />
                  </div>
                  <strong>{formatNumber(month.value)}</strong>
                  <small>{month.label}</small>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="section">
        <SectionTitle title="أحدث العمليات" hint="سجل النشاط" action={can(user, "audit.view") ? <a className="link-btn" href={routePath("/admin?tab=audit")}>عرض السجل</a> : undefined} />
        <section className="form-panel">
          {model.activity.length ? (
            <ul className="timeline">
              {model.activity.slice(0, 10).map((entry) => (
                <li key={entry.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{entry.actorName || entry.actorUsername || "النظام"}</strong>
                    <p>
                      {entry.action} · {entry.entity}
                      {entry.entityId ? ` #${entry.entityId}` : ""}
                    </p>
                    <small>{timeAgo(entry.at)}</small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="لا توجد عمليات مسجّلة بعد" hint="ستظهر العمليات هنا تلقائياً" />
          )}
        </section>
      </section>

      <section className="section">
        <SectionTitle title="اختصارات سريعة" />
        <div className="quick-grid">
          <a className="quick-card" href={routePath("/residents")}>
            <UsersRound size={20} />
            <strong>السكان</strong>
            <small>إدارة بيانات الموظفين والسكن</small>
          </a>
          <a className="quick-card" href={routePath("/operations")}>
            <ClipboardCheck size={20} />
            <strong>الحضور والدوام</strong>
            <small>متابعة الحضور والإجازات</small>
          </a>
          <a className="quick-card" href={routePath("/housing")}>
            <Building2 size={20} />
            <strong>المباني والأسرّة</strong>
            <small>الأسرّة الشاغرة والتناوبات</small>
          </a>
          <a className="quick-card" href={routePath("/reports")}>
            <ArrowUpRight size={20} />
            <strong>التقارير</strong>
            <small>تصدير Excel وPDF</small>
          </a>
        </div>
      </section>

      <div className="dash-note">
        <strong>بيانات التشغيل:</strong> الوضع {data.meta?.mode === "postgres" ? "PostgreSQL/Supabase" : "تخزين محلي JSON"} · المخطط v{data.schemaVersion} · آخر تحديث {formatDateTime(data.generatedAt)}
      </div>
    </>
  );
}
