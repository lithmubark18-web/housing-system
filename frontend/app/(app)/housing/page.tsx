"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  BedDouble,
  Building2,
  ChevronDown,
  ChevronLeft,
  DoorOpen,
  Download,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  cancelRotation,
  createBeds,
  createBuilding,
  createRoom,
  deleteBed,
  deleteBuilding,
  deleteRoom,
  executeRotation,
  fetchTextFile,
  reportCsvPath,
  scheduleRotation,
  unassignBed,
  updateBed,
  updateBuilding,
  updateRoom,
  assignBed,
} from "@/lib/api";
import { downloadCsv } from "@/lib/export";
import { formatDate, formatNumber, formatPercent, todayISO } from "@/lib/format";
import { routePath } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { Bed, BuildingTree, Room, Rotation } from "@/lib/types";
import {
  Alert,
  Badge,
  EmptyState,
  ErrorNote,
  Field,
  Loader,
  Modal,
  PageHead,
  Progress,
  SearchInput,
  Select,
  StatCard,
  TextArea,
  TextInput,
  occupancyTone,
} from "@/components/ui";

type RoomWithBeds = Room & { beds: Bed[] };

type Dialog =
  | { kind: "building"; building?: BuildingTree }
  | { kind: "room"; buildingId: string; room?: RoomWithBeds }
  | { kind: "beds"; room: RoomWithBeds }
  | { kind: "bed"; bed: Bed }
  | { kind: "rotation"; bed: Bed }
  | null;

const EMPTY_BUILDING = { name: "", location: "", notes: "", housingType: "internal" };
const EMPTY_ROOM = { name: "", floor: "", notes: "" };

const HOUSING_TYPE_LABELS: Record<string, string> = { internal: "سكن داخلي", external: "سكن خارجي" };

const HOUSING_TYPE_OPTIONS = [
  { value: "", label: "كل أنواع السكن" },
  { value: "internal", label: "سكن داخلي" },
  { value: "external", label: "سكن خارجي" },
];

const BUILDING_TYPE_OPTIONS = [
  { value: "internal", label: "سكن داخلي" },
  { value: "external", label: "سكن خارجي" },
];

export default function HousingPage() {
  const { data, user, offline, reload } = useApp();
  const [view, setView] = useState<"tree" | "beds">("tree");
  const [query, setQuery] = useState("");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedRooms, setExpandedRooms] = useState<Record<string, boolean>>({});

  const [dialog, setDialog] = useState<Dialog>(null);
  const [buildingDraft, setBuildingDraft] = useState({ ...EMPTY_BUILDING });
  const [roomDraft, setRoomDraft] = useState({ ...EMPTY_ROOM });
  const [bedsDraft, setBedsDraft] = useState({ count: "4", labelPrefix: "سرير" });
  const [bedLabel, setBedLabel] = useState("");
  const [assignResidentId, setAssignResidentId] = useState("");
  const [rotationIncoming, setRotationIncoming] = useState("");
  const [rotationDate, setRotationDate] = useState(todayISO());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canManage = can(user, "housing.manage");
  const canExport = can(user, "reports.export");
  const readOnly = offline || !canManage;

  const tree = data?.tree || [];

  useEffect(() => {
    if (tree.length && Object.keys(expanded).length === 0) {
      setExpanded({ [tree[0].id]: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.length]);

  const residentsById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; employeeCode?: string; company?: string }>();
    for (const resident of data?.residents || []) map.set(resident.id, resident);
    return map;
  }, [data]);

  const unassignedResidents = useMemo(
    () =>
      (data?.residents || [])
        .filter((resident) => !resident.bedId)
        .sort((a, b) => a.name.localeCompare(b.name, "ar")),
    [data],
  );

  const filteredBuildings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tree
      .filter((building) => !typeFilter || building.housingType === typeFilter)
      .filter((building) => !buildingFilter || building.id === buildingFilter)
      .map((building) => {
        const rooms = (building.rooms || []).filter((room) => {
          if (!needle) return true;
          const text = [room.name, room.floor, ...(room.beds || []).map((bed) => `${bed.label} ${bed.residentName || ""}`)]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return text.includes(needle) || building.name.toLowerCase().includes(needle) || (building.location || "").toLowerCase().includes(needle);
        });
        return { ...building, rooms };
      })
      .filter((building) => {
        if (buildingFilter) return true;
        if (!needle) return true;
        if (building.name.toLowerCase().includes(needle)) return true;
        if ((building.location || "").toLowerCase().includes(needle)) return true;
        return building.rooms.length > 0;
      });
  }, [tree, query, buildingFilter, typeFilter]);

  const stats = useMemo(() => {
    const beds = tree.reduce((sum, building) => sum + (building.bedCount || 0), 0);
    const occupied = tree.reduce((sum, building) => sum + (building.occupiedCount || 0), 0);
    const rooms = tree.reduce((sum, building) => sum + (building.roomCount || 0), 0);
    return {
      buildings: tree.length,
      rooms,
      beds,
      occupied,
      free: Math.max(0, beds - occupied),
      percent: beds ? Math.round((occupied / beds) * 1000) / 10 : 0,
    };
  }, [tree]);

  const rotationRows = useMemo(() => {
    const rows = data?.rotations || [];
    const bedIndex = new Map<string, { bed: Bed; room: Room; building: BuildingTree }>();
    for (const building of tree) {
      for (const room of building.rooms || []) {
        for (const bed of room.beds || []) bedIndex.set(bed.id, { bed, room, building });
      }
    }
    return rows
      .map((rotation: Rotation) => {
        const located = bedIndex.get(rotation.bedId);
        return {
          ...rotation,
          bedLabel: rotation.bedLabel || located?.bed.label || "",
          roomName: rotation.roomName || located?.room.name || "",
          buildingName: rotation.buildingName || located?.building.name || "",
          outgoingName: rotation.outgoingName || residentsById.get(rotation.outgoingResidentId)?.name || "",
          incomingName: rotation.incomingName || residentsById.get(rotation.incomingResidentId)?.name || "",
        };
      })
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }, [data, tree, residentsById]);

  function notify(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 5000);
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "تعذر تنفيذ الإجراء");
  }

  function openBuilding(building?: BuildingTree) {
    setBuildingDraft(
      building
        ? { name: building.name, location: building.location || "", notes: building.notes || "", housingType: building.housingType || "internal" }
        : { ...EMPTY_BUILDING },
    );
    setFormError("");
    setDialog({ kind: "building", building });
  }

  function openRoom(buildingId: string, room?: RoomWithBeds) {
    setRoomDraft(room ? { name: room.name, floor: room.floor || "", notes: room.notes || "" } : { ...EMPTY_ROOM });
    setFormError("");
    setDialog({ kind: "room", buildingId, room });
  }

  function openBeds(room: RoomWithBeds) {
    setBedsDraft({ count: "4", labelPrefix: "سرير" });
    setFormError("");
    setDialog({ kind: "beds", room });
  }

  function openBed(bed: Bed) {
    setBedLabel(bed.label);
    setAssignResidentId("");
    setFormError("");
    setDialog({ kind: "bed", bed });
  }

  function openRotation(bed: Bed) {
    setRotationIncoming("");
    setRotationDate(todayISO());
    setFormError("");
    setDialog({ kind: "rotation", bed });
  }

  async function saveBuilding() {
    if (!buildingDraft.name.trim()) {
      setFormError("اسم المبنى مطلوب");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: buildingDraft.name.trim(),
        location: buildingDraft.location.trim(),
        notes: buildingDraft.notes.trim(),
        housingType: buildingDraft.housingType === "external" ? "external" : "internal",
      };
      if (dialog?.kind === "building" && dialog.building) await updateBuilding(dialog.building.id, payload);
      else await createBuilding(payload);
      setDialog(null);
      await reload();
      notify(dialog?.kind === "building" && dialog.building ? "تم تحديث المبنى" : "تمت إضافة المبنى");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر حفظ المبنى");
    } finally {
      setSaving(false);
    }
  }

  async function saveRoom() {
    if (dialog?.kind !== "room") return;
    if (!roomDraft.name.trim()) {
      setFormError("اسم الغرفة مطلوب");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: roomDraft.name.trim(),
        floor: roomDraft.floor.trim(),
        notes: roomDraft.notes.trim(),
      };
      if (dialog.room) await updateRoom(dialog.room.id, payload);
      else await createRoom(dialog.buildingId, payload);
      setDialog(null);
      await reload();
      notify(dialog.room ? "تم تحديث الغرفة" : "تمت إضافة الغرفة");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر حفظ الغرفة");
    } finally {
      setSaving(false);
    }
  }

  async function saveBeds() {
    if (dialog?.kind !== "beds") return;
    const count = Number(bedsDraft.count);
    if (!Number.isFinite(count) || count < 1) {
      setFormError("عدد الأسرّة غير صحيح");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await createBeds(dialog.room.id, { count, labelPrefix: bedsDraft.labelPrefix.trim() || "سرير" });
      setDialog(null);
      await reload();
      notify(`تمت إضافة ${formatNumber(count)} سرير`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر إضافة الأسرّة");
    } finally {
      setSaving(false);
    }
  }

  async function saveBed() {
    if (dialog?.kind !== "bed") return;
    setSaving(true);
    setFormError("");
    try {
      if (assignResidentId && !dialog.bed.occupied) {
        await assignBed(assignResidentId, dialog.bed.id);
        setDialog(null);
        await reload();
        notify("تم تخصيص السرير للساكن");
        return;
      }
      if (bedLabel.trim() && bedLabel.trim() !== dialog.bed.label) {
        await updateBed(dialog.bed.id, { label: bedLabel.trim() });
        setDialog(null);
        await reload();
        notify("تم تحديث اسم السرير");
        return;
      }
      setFormError("اختر ساكناً لتخصيص السرير أو عدّل اسم السرير");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر حفظ السرير");
    } finally {
      setSaving(false);
    }
  }

  async function releaseBed(bed: Bed) {
    if (!bed.residentId) return;
    if (!window.confirm(`إخلاء السرير ${bed.label} من ${bed.residentName || "الساكن"}؟`)) return;
    setBusy(true);
    try {
      await unassignBed(bed.residentId);
      setDialog(null);
      await reload();
      notify("تم إخلاء السرير");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeBed(bed: Bed) {
    if (!window.confirm(`حذف السرير ${bed.label}؟`)) return;
    setBusy(true);
    try {
      await deleteBed(bed.id);
      setDialog(null);
      await reload();
      notify("تم حذف السرير");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeRoom(room: RoomWithBeds) {
    if (!window.confirm(`حذف الغرفة ${room.name}؟`)) return;
    setBusy(true);
    try {
      await deleteRoom(room.id);
      await reload();
      notify("تم حذف الغرفة");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeBuilding(building: BuildingTree) {
    if (!window.confirm(`حذف المبنى ${building.name}؟`)) return;
    setBusy(true);
    try {
      await deleteBuilding(building.id);
      await reload();
      notify("تم حذف المبنى");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveRotation() {
    if (dialog?.kind !== "rotation") return;
    if (!rotationIncoming) {
      setFormError("اختر الساكن التالي");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await scheduleRotation({
        bedId: dialog.bed.id,
        outgoingResidentId: dialog.bed.residentId || "",
        incomingResidentId: rotationIncoming,
        scheduledFor: rotationDate,
      });
      setDialog(null);
      await reload();
      notify("تم جدولة التناوب");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر جدولة التناوب");
    } finally {
      setSaving(false);
    }
  }

  async function runRotation(rotation: Rotation) {
    if (!window.confirm(`تنفيذ التناوب على السرير ${rotation.bedLabel || ""}؟ سيتم نقل الساكن الحالي وإسكان الساكن الجديد.`)) return;
    setBusy(true);
    try {
      await executeRotation(rotation.id);
      await reload();
      notify("تم تنفيذ التناوب");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function stopRotation(rotation: Rotation) {
    if (!window.confirm("إلغاء التناوب المجدول؟")) return;
    setBusy(true);
    try {
      await cancelRotation(rotation.id);
      await reload();
      notify("تم إلغاء التناوب");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function exportOccupancy() {
    setBusy(true);
    try {
      const file = await fetchTextFile(reportCsvPath("buildings"));
      downloadCsv(`occupancy-${todayISO()}.csv`, file.content);
      notify("تم تصدير تقرير الإشغال");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Loader label="جارٍ تحميل السكن..." />;

  const pendingRotations = rotationRows.filter((rotation) => rotation.status === "مجدول");

  return (
    <>
      <PageHead
        eyebrow="السكن"
        title="المباني والغرف والأسرّة"
        subtitle={`${formatNumber(stats.buildings)} مبنى · ${formatNumber(stats.rooms)} غرفة · ${formatNumber(stats.beds)} سرير · ${formatPercent(stats.percent)} إشغال`}
        actions={
          <div className="head-actions">
            {canExport && (
              <button type="button" className="secondary-btn" onClick={exportOccupancy} disabled={busy || offline}>
                <Download size={16} /> تصدير الإشغال
              </button>
            )}
            <button type="button" className="secondary-btn" onClick={() => reload()} disabled={busy}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canManage && (
              <button type="button" className="primary-btn" onClick={() => openBuilding()} disabled={offline}>
                <Plus size={16} /> مبنى جديد
              </button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {offline && <Alert tone="warning">وضع دون إنترنت: عرض فقط. أعد الاتصال لإدارة المباني والأسرّة.</Alert>}
      {stats.percent >= 90 && stats.beds > 0 && (
        <Alert tone="warning">
          نسبة الإشغال مرتفعة ({formatPercent(stats.percent)}). راجع الأسرّة الشاغرة ({formatNumber(stats.free)}) أو أضف سعة جديدة.
        </Alert>
      )}

      <div className="stats-grid stats-grid-4">
        <StatCard icon={Building2} label="المباني" value={formatNumber(stats.buildings)} hint={`${formatNumber(stats.rooms)} غرفة`} />
        <StatCard icon={BedDouble} label="إجمالي الأسرّة" value={formatNumber(stats.beds)} tone="muted" />
        <StatCard icon={UsersRound} label="أسرّة مشغولة" value={formatNumber(stats.occupied)} hint={formatPercent(stats.percent)} tone={occupancyTone(stats.percent)} />
        <StatCard icon={Layers} label="أسرّة شاغرة" value={formatNumber(stats.free)} hint="جاهزة للتخصيص" tone={stats.free ? "success" : "danger"} />
      </div>

      <section className="form-panel filters-panel">
        <div className="filters-row">
          <SearchInput value={query} onChange={setQuery} placeholder="بحث في المباني والغرف والأسماء..." />
          <Select
            value={buildingFilter}
            onChange={(event) => setBuildingFilter(event.target.value)}
            placeholder="كل المباني"
            options={tree.map((building) => ({ value: building.id, label: building.name }))}
          />
          <Select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            options={HOUSING_TYPE_OPTIONS}
            placeholder="كل أنواع السكن"
          />
          <div className="segmented-row view-toggle">
            <button type="button" className={view === "tree" ? "active" : ""} onClick={() => setView("tree")}>
              <Building2 size={15} /> شجرة السكن
            </button>
            <button type="button" className={view === "beds" ? "active" : ""} onClick={() => setView("beds")}>
              <BedDouble size={15} /> شبكة الأسرّة
            </button>
          </div>
        </div>
        <div className="filters-foot">
          <span>
            الأسرّة الشاغرة: <strong>{formatNumber(stats.free)}</strong> · التناوبات المجدولة: <strong>{formatNumber(pendingRotations.length)}</strong>
          </span>
          {view === "beds" && (
            <label className="check-item">
              <input type="checkbox" checked={freeOnly} onChange={(event) => setFreeOnly(event.target.checked)} />
              الشاغرة فقط
            </label>
          )}
        </div>
      </section>

      {!tree.length ? (
        <EmptyState
          title="لا توجد مباني مسجّلة"
          hint={canManage ? "ابدأ بإضافة مبنى ثم أضف الغرف والأسرّة" : "اطلب من مراقب السكن إضافة المباني"}
          action={canManage ? <button type="button" className="primary-btn" onClick={() => openBuilding()}><Plus size={16} /> إضافة مبنى</button> : undefined}
        />
      ) : view === "tree" ? (
        <div className="accordion">
          {filteredBuildings.map((building) => {
            const isOpen = expanded[building.id] ?? false;
            return (
              <section className="accordion-card" key={building.id}>
                <header className="accordion-head">
                  <button type="button" className="accordion-toggle" onClick={() => setExpanded((current) => ({ ...current, [building.id]: !isOpen }))}>
                    <span className="accordion-icon"><Building2 size={19} /></span>
                    <span className="accordion-title">
                      <strong>{building.name}</strong>{" "}
                      {building.housingType && (
                        <Badge tone={building.housingType === "external" ? "warn" : "info"}>{HOUSING_TYPE_LABELS[building.housingType]}</Badge>
                      )}
                      <small>
                        {building.location || "بدون موقع"} · {formatNumber(building.roomCount)} غرفة · {formatNumber(building.bedCount)} سرير
                      </small>
                    </span>
                    <span className="accordion-metrics">
                      <Badge tone={occupancyTone(building.occupancyPercent)}>{formatPercent(building.occupancyPercent)}</Badge>
                      <small>{formatNumber(building.freeCount)} شاغر</small>
                    </span>
                    <ChevronDown size={18} className={`accordion-caret ${isOpen ? "open" : ""}`} />
                  </button>
                  {canManage && (
                    <div className="accordion-actions">
                      <button type="button" className="icon-plain" title="إضافة غرفة" onClick={() => openRoom(building.id)} disabled={offline}>
                        <Plus size={17} />
                      </button>
                      <button type="button" className="icon-plain" title="تعديل المبنى" onClick={() => openBuilding(building)} disabled={offline}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" className="icon-plain danger" title="حذف المبنى" onClick={() => removeBuilding(building)} disabled={offline || busy}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </header>

                {isOpen && (
                  <div className="accordion-body">
                    <div className="building-progress">
                      <Progress value={building.occupancyPercent} tone={occupancyTone(building.occupancyPercent)} />
                      <span>
                        {formatNumber(building.occupiedCount)} / {formatNumber(building.bedCount)} سرير مشغول · {formatNumber(building.residentCount)} ساكن مرتبط
                      </span>
                    </div>

                    {building.notes && <p className="muted small-note">{building.notes}</p>}
                    {!building.rooms.length ? (
                      <EmptyState
                        title="لا توجد غرف في هذا المبنى"
                        hint={canManage ? "أضف غرفة للبدء في توزيع الأسرّة" : undefined}
                        action={canManage ? <button type="button" className="secondary-btn" onClick={() => openRoom(building.id)}><Plus size={15} /> إضافة غرفة</button> : undefined}
                      />
                    ) : (
                      <div className="room-grid">
                        {building.rooms.map((room) => {
                          const roomOpen = expandedRooms[room.id] ?? true;
                          return (
                            <article className="room-card" key={room.id}>
                              <header className="room-head">
                                <button type="button" className="room-toggle" onClick={() => setExpandedRooms((current) => ({ ...current, [room.id]: !roomOpen }))}>
                                  <DoorOpen size={17} />
                                  <span>
                                    <strong>{room.name}</strong>
                                    <small>
                                      {room.floor || "الأرضي"} · {formatNumber(room.bedCount)} سرير · {formatNumber(room.freeCount)} شاغر
                                    </small>
                                  </span>
                                  <ChevronLeft size={15} className={`room-caret ${roomOpen ? "open" : ""}`} />
                                </button>
                                {canManage && (
                                  <div className="room-actions">
                                    <button type="button" className="icon-plain" title="إضافة أسرّة" onClick={() => openBeds(room)} disabled={offline}>
                                      <Plus size={15} />
                                    </button>
                                    <button type="button" className="icon-plain" title="تعديل الغرفة" onClick={() => openRoom(building.id, room)} disabled={offline}>
                                      <Pencil size={14} />
                                    </button>
                                    <button type="button" className="icon-plain danger" title="حذف الغرفة" onClick={() => removeRoom(room)} disabled={offline || busy}>
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                )}
                              </header>

                              {roomOpen && (
                                <>
                                  {room.beds.length ? (
                                    <div className="bed-grid">
                                      {room.beds.map((bed) => {
                                        const hidden = freeOnly && bed.occupied;
                                        if (hidden) return null;
                                        return (
                                          <button
                                            type="button"
                                            key={bed.id}
                                            className={`bed-chip ${bed.occupied ? "occupied" : "free"}`}
                                            title={bed.occupied ? `${bed.label} — ${bed.residentName || "مشغول"}` : `${bed.label} — شاغر`}
                                            onClick={() => openBed(bed)}
                                          >
                                            <BedDouble size={15} />
                                            <span>{bed.label}</span>
                                            <small>{bed.occupied ? bed.residentName || "مشغول" : "شاغر"}</small>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="room-empty">
                                      <span>لا توجد أسرّة</span>
                                      {canManage && (
                                        <button type="button" className="link-btn" onClick={() => openBeds(room)} disabled={offline}>
                                          إضافة أسرّة
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {room.notes && <p className="muted small-note">{room.notes}</p>}
                                </>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          {!filteredBuildings.length && <EmptyState title="لا توجد نتائج مطابقة" hint="جرّب تعديل كلمات البحث أو المبنى المحدد" />}
        </div>
      ) : (
        <div className="bed-board">
          {filteredBuildings.map((building) => (
            <section className="bed-board-building" key={building.id}>
              <header>
                <strong>{building.name}</strong>
                <span>{formatNumber(building.occupiedCount)} / {formatNumber(building.bedCount)} سرير</span>
              </header>
              {building.rooms.map((room) => {
                const beds = (room.beds || []).filter((bed) => !freeOnly || !bed.occupied);
                if (!beds.length) return null;
                return (
                  <div className="bed-board-room" key={room.id}>
                    <div className="bed-board-room-title">
                      <span>{room.name}</span>
                      <small>{room.floor || "الأرضي"}</small>
                    </div>
                    <div className="bed-grid">
                      {beds.map((bed) => (
                        <button
                          type="button"
                          key={bed.id}
                          className={`bed-chip ${bed.occupied ? "occupied" : "free"}`}
                          onClick={() => openBed(bed)}
                        >
                          <BedDouble size={15} />
                          <span>{bed.label}</span>
                          <small>{bed.occupied ? bed.residentName || "مشغول" : "شاغر"}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
          {freeOnly && !filteredBuildings.some((building) => building.rooms.some((room) => room.beds.some((bed) => !bed.occupied))) && (
            <EmptyState title="لا توجد أسرّة شاغرة" hint="كل الأسرّة مشغولة حالياً" />
          )}
        </div>
      )}

      <section className="section">
        <div className="section-title">
          <div>
            <h2>تناوب الأسرّة</h2>
            <span>{formatNumber(pendingRotations.length)} تناوب مجدول · {formatNumber(rotationRows.length)} سجل</span>
          </div>
        </div>
        <section className="table-card">
          {rotationRows.length ? (
            <div className="table-scroll">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>السرير</th>
                    <th>الموقع</th>
                    <th>الساكن الحالي</th>
                    <th>الساكن التالي</th>
                    <th>التاريخ</th>
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {rotationRows.slice(0, 100).map((rotation) => (
                    <tr key={rotation.id}>
                      <td><strong>{rotation.bedLabel || "—"}</strong></td>
                      <td>{rotation.buildingName || "—"} {rotation.roomName ? `· ${rotation.roomName}` : ""}</td>
                      <td>{rotation.outgoingName || "—"}</td>
                      <td>{rotation.incomingName || "—"}</td>
                      <td>{formatDate(rotation.scheduledFor)}</td>
                      <td><Badge tone={rotation.status === "منفذ" ? "good" : rotation.status === "ملغي" ? "bad" : "warn"}>{rotation.status}</Badge></td>
                      <td>
                        {canManage && rotation.status === "مجدول" ? (
                          <div className="row-actions">
                            <button type="button" className="secondary-btn small-btn" onClick={() => runRotation(rotation)} disabled={offline || busy}>
                              <ArrowLeftRight size={14} /> تنفيذ
                            </button>
                            <button type="button" className="danger-btn small-btn" onClick={() => stopRotation(rotation)} disabled={offline || busy}>
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="لا توجد تناوبات"
              hint="افتح سريراً مشغولاً من الشجرة أو الشبكة ثم اختر «جدولة تناوب»"
            />
          )}
        </section>
      </section>

      {/* ------------------------------ نافذة المبنى ------------------------------ */}
      <Modal
        open={dialog?.kind === "building"}
        title={dialog?.kind === "building" && dialog.building ? "تعديل المبنى" : "مبنى جديد"}
        subtitle="الاسم والموقع يظهران في التقارير وشبكة السكن"
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveBuilding} disabled={saving || readOnly}>
              {saving ? "جارٍ الحفظ..." : "حفظ"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="اسم المبنى" required>
            <TextInput value={buildingDraft.name} onChange={(event) => setBuildingDraft({ ...buildingDraft, name: event.target.value })} placeholder="مثال: مبنى A" />
          </Field>
          <Field label="الموقع">
            <TextInput value={buildingDraft.location} onChange={(event) => setBuildingDraft({ ...buildingDraft, location: event.target.value })} placeholder="مثال: المنطقة الصناعية" />
          </Field>
          <Field label="نوع السكن" hint="يُستخدم لفصل الاعتمادات الداخلية عن الخارجية ويعرض في التقارير">
            <Select
              value={buildingDraft.housingType}
              onChange={(event) => setBuildingDraft({ ...buildingDraft, housingType: event.target.value })}
              options={BUILDING_TYPE_OPTIONS}
            />
          </Field>
          <Field label="ملاحظات" className="full">
            <TextArea rows={3} value={buildingDraft.notes} onChange={(event) => setBuildingDraft({ ...buildingDraft, notes: event.target.value })} />
          </Field>
        </div>
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>

      {/* ------------------------------ نافذة الغرفة ------------------------------ */}
      <Modal
        open={dialog?.kind === "room"}
        title={dialog?.kind === "room" && dialog.room ? "تعديل الغرفة" : "غرفة جديدة"}
        subtitle="كل غرفة تحتوي مجموعة أسرّة قابلة للتخصيص"
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveRoom} disabled={saving || readOnly}>
              {saving ? "جارٍ الحفظ..." : "حفظ"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="اسم الغرفة" required>
            <TextInput value={roomDraft.name} onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value })} placeholder="مثال: غرفة 101" />
          </Field>
          <Field label="الدور">
            <TextInput value={roomDraft.floor} onChange={(event) => setRoomDraft({ ...roomDraft, floor: event.target.value })} placeholder="الأرضي / الأول..." />
          </Field>
          <Field label="ملاحظات" className="full">
            <TextArea rows={3} value={roomDraft.notes} onChange={(event) => setRoomDraft({ ...roomDraft, notes: event.target.value })} />
          </Field>
        </div>
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>

      {/* ------------------------------ نافذة الأسرّة ----------------------------- */}
      <Modal
        open={dialog?.kind === "beds"}
        title="إضافة أسرّة"
        subtitle={dialog?.kind === "beds" ? `الغرفة: ${dialog.room.name}` : undefined}
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveBeds} disabled={saving || readOnly}>
              {saving ? "جارٍ الإضافة..." : "إضافة"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="عدد الأسرّة" hint="من 1 إلى 50 سريراً في المرة" required>
            <TextInput type="number" min={1} max={50} value={bedsDraft.count} onChange={(event) => setBedsDraft({ ...bedsDraft, count: event.target.value })} />
          </Field>
          <Field label="بادئة التسمية" hint="مثال: سرير — ستكون التسميات سرير 5، سرير 6...">
            <TextInput value={bedsDraft.labelPrefix} onChange={(event) => setBedsDraft({ ...bedsDraft, labelPrefix: event.target.value })} />
          </Field>
        </div>
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>

      {/* ------------------------------ نافذة السرير ------------------------------ */}
      <Modal
        open={dialog?.kind === "bed"}
        title={dialog?.kind === "bed" ? `السرير ${dialog.bed.label}` : "السرير"}
        subtitle={dialog?.kind === "bed" ? `${dialog.bed.buildingName || ""} · ${dialog.bed.roomName || ""}` : undefined}
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>إغلاق</button>
            {dialog?.kind === "bed" && !dialog.bed.occupied && canManage && (
              <button type="button" className="primary-btn" onClick={saveBed} disabled={saving || readOnly || !assignResidentId}>
                <UserRound size={16} /> تخصيص السرير
              </button>
            )}
            {dialog?.kind === "bed" && dialog.bed.occupied && canManage && (
              <>
                <button type="button" className="danger-btn" onClick={() => releaseBed(dialog.bed)} disabled={busy || offline}>
                  إخلاء السرير
                </button>
                <button type="button" className="primary-btn" onClick={() => openRotation(dialog.bed)} disabled={offline}>
                  <ArrowLeftRight size={16} /> جدولة تناوب
                </button>
              </>
            )}
          </>
        }
      >
        {dialog?.kind === "bed" && (
          <div className="stack-lg">
            {dialog.bed.occupied ? (
              <>
                <div className="bed-occupant">
                  <span className="avatar"><UserRound size={18} /></span>
                  <div>
                    <strong>{dialog.bed.residentName || "ساكن"}</strong>
                    <small>
                      {dialog.bed.employeeCode ? `الرقم الوظيفي: ${dialog.bed.employeeCode}` : "بدون رقم وظيفي"}
                    </small>
                  </div>
                  {dialog.bed.residentId && (
                    <a className="secondary-btn" href={routePath(`/residents?highlight=${encodeURIComponent(dialog.bed.residentId)}`)}>
                      ملف الساكن
                    </a>
                  )}
                </div>
                <Alert tone="info">لنقل الساكن إلى سرير آخر استخدم «تخصيص» من صفحة السكان، أو جدول تناوباً ليحل ساكن جديد مكانه.</Alert>
              </>
            ) : (
              <>
                <Field label="تخصيص لساكن (بدون سرير)" hint="تظهر فقط قائمة السكان غير المسكّنين">
                  <Select
                    value={assignResidentId}
                    onChange={(event) => setAssignResidentId(event.target.value)}
                    placeholder="اختر ساكناً..."
                    options={unassignedResidents.map((resident) => ({
                      value: resident.id,
                      label: `${resident.name}${resident.employeeCode ? ` — ${resident.employeeCode}` : ""}`,
                    }))}
                  />
                </Field>
                {!unassignedResidents.length && <Alert tone="warning">لا يوجد سكان بدون سرير حالياً.</Alert>}
              </>
            )}

            {canManage && (
              <Field label="اسم السرير" hint="يُستخدم في التقارير وشبكة الأسرّة">
                <div className="inline-field">
                  <TextInput value={bedLabel} onChange={(event) => setBedLabel(event.target.value)} />
                  <button type="button" className="secondary-btn" onClick={saveBed} disabled={saving || readOnly || !bedLabel.trim() || bedLabel.trim() === dialog.bed.label}>
                    حفظ الاسم
                  </button>
                </div>
              </Field>
            )}

            {canManage && !dialog.bed.occupied && (
              <button type="button" className="danger-btn" onClick={() => removeBed(dialog.bed)} disabled={busy || offline}>
                <Trash2 size={16} /> حذف السرير
              </button>
            )}
            {formError && <Alert tone="danger">{formError}</Alert>}
          </div>
        )}
      </Modal>

      {/* ------------------------------ نافذة التناوب ----------------------------- */}
      <Modal
        open={dialog?.kind === "rotation"}
        title="جدولة تناوب"
        subtitle={dialog?.kind === "rotation" ? `السرير ${dialog.bed.label} — ${dialog.bed.residentName || ""}` : undefined}
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveRotation} disabled={saving || readOnly || !rotationIncoming}>
              <RotateCcw size={16} /> جدولة
            </button>
          </>
        }
      >
        {dialog?.kind === "rotation" && (
          <div className="stack-lg">
            <Alert tone="info">
              سيُنشأ طلب «نقل سرير» تلقائياً. عند التنفيذ يُنقل الساكن الحالي خارج السرير ويُسكن الساكن التالي بدلاً منه.
            </Alert>
            <Field label="الساكن الحالي">
              <TextInput value={dialog.bed.residentName || ""} readOnly />
            </Field>
            <Field label="الساكن التالي (بدون سرير)" required>
              <Select
                value={rotationIncoming}
                onChange={(event) => setRotationIncoming(event.target.value)}
                placeholder="اختر الساكن التالي..."
                options={unassignedResidents
                  .filter((resident) => resident.id !== dialog.bed.residentId)
                  .map((resident) => ({
                    value: resident.id,
                    label: `${resident.name}${resident.employeeCode ? ` — ${resident.employeeCode}` : ""}`,
                  }))}
              />
            </Field>
            <Field label="تاريخ التنفيذ">
              <TextInput type="date" value={rotationDate} onChange={(event) => setRotationDate(event.target.value)} />
            </Field>
            {!unassignedResidents.length && <Alert tone="warning">لا يوجد سكان بدون سرير لجدولة تناوب.</Alert>}
            {formError && <Alert tone="danger">{formError}</Alert>}
          </div>
        )}
      </Modal>
    </>
  );
}
