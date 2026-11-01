import type { Bootstrap, BuildingTree, ContractorRequest, Resident } from "./types";

export function housingResidents(residents: Resident[]): Resident[] {
  return residents.filter((resident) => resident.serviceType === "سكن" || resident.isHousingService === true);
}

export function countBy<T>(items: T[], keyOf: (item: T) => string): Array<{ label: string; value: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = (keyOf(item) || "غير محدد").trim() || "غير محدد";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export function attendanceSummary(residents: Resident[]) {
  const result = { present: 0, away: 0, leave: 0, absent: 0, unknown: 0, assigned: 0, unassigned: 0 };
  for (const resident of residents) {
    if (resident.isAssigned || resident.bedId) result.assigned += 1;
    else result.unassigned += 1;
    const status = resident.attendanceStatus || "";
    if (status.includes("إجازة") || status.includes("اجازة") || status.includes("راحة")) result.leave += 1;
    else result.present += 1;
  }
  return result;
}

export function occupancySummary(buildings: BuildingTree[], fallbackBeds?: Bootstrap["beds"]) {
  const bedCount = buildings.length
    ? buildings.reduce((sum, building) => sum + (building.bedCount || 0), 0)
    : fallbackBeds?.length || 0;
  const occupied = buildings.length
    ? buildings.reduce((sum, building) => sum + (building.occupiedCount || 0), 0)
    : fallbackBeds?.filter((bed) => bed.occupied).length || 0;
  return {
    beds: bedCount,
    occupied,
    free: Math.max(0, bedCount - occupied),
    percent: bedCount ? Math.round((occupied / bedCount) * 1000) / 10 : 0,
  };
}

export function contractorUsage(contractors: Bootstrap["contractors"]) {
  return contractors
    .map((contractor) => {
      const stats = contractor.stats;
      const capacity = stats?.capacity ?? contractor.bedQuota ?? 0;
      const workers = stats?.workerCount ?? 0;
      const percent = capacity ? Math.round((workers / capacity) * 1000) / 10 : 0;
      return {
        id: contractor.id,
        name: contractor.name,
        status: contractor.status || "active",
        workers,
        capacity,
        freeQuota: stats?.freeQuota ?? Math.max(0, capacity - workers),
        physicalBeds: stats?.physicalBeds ?? 0,
        freePhysicalBeds: stats?.freePhysicalBeds ?? 0,
        percent,
        buildings: contractor.buildingNames || [],
        pendingRequests: stats?.pendingRequests ?? 0,
      };
    })
    .sort((a, b) => b.percent - a.percent);
}

export const STAGE_ORDER = ["housing", "security", "visitor", "done", "rejected"] as const;

export function contractorStageCounts(requests: ContractorRequest[]): Array<{ stage: string; label: string; value: number }> {
  const labels: Record<string, string> = {
    housing: "اعتماد السكن",
    security: "الاعتماد الأمني",
    visitor: "اعتماد الزوار",
    done: "مكتمل",
    rejected: "مرفوض",
  };
  return STAGE_ORDER.map((stage) => ({
    stage,
    label: labels[stage],
    value: requests.filter((request) => request.stage === stage).length,
  }));
}

export function monthlyFromRequests(requests: Array<{ createdAt: string }>): Array<{ label: string; value: number }> {
  const buckets = new Map<string, number>();
  const now = new Date();
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, 0);
  }
  for (const request of requests) {
    const date = new Date(request.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  return Array.from(buckets.entries()).map(([key, value]) => {
    const month = Number(key.split("-")[1]) - 1;
    return { label: monthNames[month], value };
  });
}

export function contractorRequestAging(requests: ContractorRequest[]): { pending: number; oldestDays: number } {
  const pending = requests.filter((request) => request.stage !== "done" && request.stage !== "rejected");
  let oldest = 0;
  for (const request of pending) {
    const created = new Date(request.createdAt).getTime();
    if (Number.isNaN(created)) continue;
    oldest = Math.max(oldest, Math.floor((Date.now() - created) / 86400000));
  }
  return { pending: pending.length, oldestDays: oldest };
}
