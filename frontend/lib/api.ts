import { backendBaseUrl, isNativePlatform, nativeRequest, normalizeBaseUrl } from "./offlineStore";
import type {
  AttendanceReport,
  AuditEntry,
  Bootstrap,
  BuildingTree,
  Contractor,
  ContractorPortal,
  ContractorRequest,
  ContractorStats,
  ContractorWorker,
  Dashboard,
  DutyReport,
  GroupRow,
  HousingRequest,
  ListResponse,
  Notification,
  Resident,
  Role,
  Rotation,
  Settings,
  User,
} from "./types";

export type { User } from "./types";

const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

export function getToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(ACCESS_KEY);
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function storeSession(data: {
  access_token?: string;
  refresh_token?: string;
  user?: User;
}) {
  if (typeof window === "undefined") return;
  if (data.access_token) window.localStorage.setItem(ACCESS_KEY, data.access_token);
  if (data.refresh_token) window.localStorage.setItem(REFRESH_KEY, data.refresh_token);
  if (data.user) window.localStorage.setItem("user", JSON.stringify(data.user));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem("user");
}

let signedOut = false;

export function logoutLocal() {
  signedOut = true;
  clearSession();
}

export function markSignedIn() {
  signedOut = false;
}

export function baseUrl(): string {
  return backendBaseUrl();
}

function detailMessage(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg).replace(/^Value error,\s*/, "");
        }
        return typeof item === "string" ? item : "";
      })
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof detail === "object") return JSON.stringify(detail);
  return String(detail);
}

async function refreshToken(): Promise<boolean> {
  if (typeof window === "undefined" || signedOut) return false;
  const base = baseUrl();
  const refresh = window.localStorage.getItem(REFRESH_KEY);
  if (!base || !refresh) return false;
  try {
    const res = await nativeRequest(`${base}/api/auth/refresh`, {
      method: "POST",
      body: { refresh_token: refresh },
      timeoutMs: 30000,
    });
    if (res.ok && res.data && typeof res.data === "object") {
      const payload = res.data as { access_token?: string; refresh_token?: string; user?: User };
      if (payload.access_token) {
        storeSession(payload);
        return true;
      }
    }
  } catch {
    /* تجاهل */
  }
  return false;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  retry?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = baseUrl();
  if (!base) throw new Error("لم يُضبط عنوان الخادم — تحقق من إعدادات الاتصال");
  const send = async (token: string | null) =>
    nativeRequest(`${base}${path}`, {
      method: options.method || "GET",
      body: options.body,
      timeoutMs: options.timeoutMs ?? 60000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  let res = await send(getToken());
  if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/refresh") {
    if (await refreshToken()) {
      res = await send(getToken());
    }
  }

  const body = res.data as { detail?: unknown } | null;
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/auth/login") {
      signedOut = true;
      clearSession();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/change-password")) {
        window.location.assign("/");
      }
    }
    throw new Error(detailMessage(body?.detail) || `فشل الطلب (${res.status})`);
  }
  return body as T;
}

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === "" || value === null || value === undefined) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/* ----------------------------------- Auth ---------------------------------- */

export async function healthProbe(timeoutMs = 4000): Promise<boolean> {
  if (typeof fetch === "undefined") return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${baseUrl()}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

export async function apiLogin(username: string, password: string) {
  const res = await request<{
    access_token: string;
    refresh_token: string;
    token?: string;
    user: User;
  }>("/api/auth/login", { method: "POST", body: { username, password } });
  markSignedIn();
  storeSession(res);
  return res;
}

export function apiRefresh() {
  return request<{ access_token: string; refresh_token: string; user: User }>("/api/auth/refresh", {
    method: "POST",
    body: { refresh_token: typeof window !== "undefined" ? window.localStorage.getItem(REFRESH_KEY) : "" },
  });
}

export async function changePassword(current_password: string, new_password: string) {
  const res = await request<{ access_token: string; refresh_token: string; user: User }>("/api/auth/change-password", {
    method: "POST",
    body: { current_password, new_password },
  });
  storeSession(res);
  return res;
}

export function logoutAllDevices() {
  return request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: { allDevices: true } });
}

export function getSession() {
  return request<{ user: User; settings: Settings }>("/api/auth/session");
}

/* --------------------------------- Bootstrap -------------------------------- */

export function getBootstrap() {
  return request<Bootstrap>("/api/bootstrap");
}

export function getBootstrapVersion() {
  return request<{ version: string; schemaVersion: number; serverTime: string; counts: Record<string, number>; mode: string }>(
    "/api/bootstrap/version",
  );
}

/* --------------------------------- Residents -------------------------------- */

export type ResidentFilters = {
  q?: string;
  buildingId?: string;
  roomId?: string;
  contractorId?: string;
  status?: string;
  serviceType?: string;
  assigned?: boolean | null;
  housingOnly?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
};

export function listResidents(filters: ResidentFilters = {}) {
  return request<ListResponse<Resident> & { data: Resident[] }>(`/api/residents${query(filters as Record<string, string | number | boolean | null | undefined>)}`);
}

export function getResident(id: string) {
  return request<Resident>(`/api/residents/${encodeURIComponent(id)}`);
}

export function residentHistory(id: string) {
  return request<{ items: AuditEntry[]; total: number }>(`/api/residents/${encodeURIComponent(id)}/history`);
}

export function createResident(payload: Partial<Resident> & Record<string, unknown>) {
  return request<Resident>("/api/residents", { method: "POST", body: payload });
}

export function updateResident(id: string, payload: Record<string, unknown>) {
  return request<Resident>(`/api/residents/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export function deleteResident(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/residents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function assignBed(id: string, bedId: string) {
  return request<Resident>(`/api/residents/${encodeURIComponent(id)}/assign-bed`, { method: "POST", body: { bedId } });
}

export function unassignBed(id: string) {
  return request<Resident>(`/api/residents/${encodeURIComponent(id)}/unassign-bed`, { method: "POST" });
}

export function bulkAssignResidents(payload: { residentIds: string[]; bedId?: string; roomId?: string; buildingId?: string }) {
  return request<{ ok: boolean; assigned: Array<{ residentId: string; name: string; bedId: string; bedLabel: string }>; skipped: string[]; count: number }>(
    "/api/residents/bulk-assign",
    { method: "POST", body: payload },
  );
}

export function importResidents(residents: Array<Record<string, unknown>>) {
  return request<{ ok: boolean; created: number; updated: number; failed: number; errors: Array<{ row: number; name?: string; error: string }>; total: number }>(
    "/api/residents/import",
    { method: "POST", body: { residents } },
  );
}

/* ------------------------------- Buildings/Rooms ----------------------------- */

export function getHousingTree() {
  return request<{ buildings: BuildingTree[]; generatedAt: string }>("/api/housing/tree");
}

export function listBuildings() {
  return request<{ items: BuildingTree[]; total: number }>("/api/housing/buildings");
}

export function createBuilding(payload: Record<string, unknown>) {
  return request<Record<string, unknown>>("/api/housing/buildings", { method: "POST", body: payload });
}

export function updateBuilding(id: string, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(`/api/housing/buildings/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export function deleteBuilding(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/housing/buildings/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function createRoom(buildingId: string, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(`/api/housing/buildings/${encodeURIComponent(buildingId)}/rooms`, {
    method: "POST",
    body: payload,
  });
}

export function listRooms(buildingId?: string) {
  return request<{ items: Array<Record<string, unknown>>; total: number }>(`/api/housing/rooms${query({ buildingId })}`);
}

export function updateRoom(id: string, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(`/api/housing/rooms/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export function deleteRoom(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/housing/rooms/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function createBeds(roomId: string, payload: { count?: number; label?: string; labelPrefix?: string; labels?: string[] }) {
  return request<{ items: Array<Record<string, unknown>>; created: number }>(`/api/housing/rooms/${encodeURIComponent(roomId)}/beds`, {
    method: "POST",
    body: payload,
  });
}

export function listBeds(params: { buildingId?: string; roomId?: string; freeOnly?: boolean; q?: string; page?: number; pageSize?: number } = {}) {
  return request<ListResponse<Record<string, unknown>>>(`/api/housing/beds${query(params)}`);
}

export function updateBed(id: string, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(`/api/housing/beds/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export function deleteBed(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/housing/beds/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* --------------------------------- Rotations --------------------------------- */

export function listRotations(status?: string) {
  return request<{ items: Rotation[]; total: number }>(`/api/housing/rotations${query({ status })}`);
}

export function scheduleRotation(payload: { bedId: string; outgoingResidentId: string; incomingResidentId: string; scheduledFor: string }) {
  return request<Rotation>("/api/housing/rotations", { method: "POST", body: payload });
}

export function executeRotation(id: string) {
  return request<Rotation>(`/api/housing/rotations/${encodeURIComponent(id)}/execute`, { method: "POST" });
}

export function cancelRotation(id: string) {
  return request<Rotation>(`/api/housing/rotations/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

/* ----------------------------- Housing requests ------------------------------ */

export function listHousingRequests(params: { status?: string; requestType?: string; q?: string; page?: number; pageSize?: number } = {}) {
  return request<
    ListResponse<HousingRequest> & {
      data: HousingRequest[];
      types: Array<{ value: string; label: string }> | string[];
      statuses: string[];
      summary: { total: number; pending: number };
    }
  >(`/api/requests${query(params)}`);
}

export function getHousingRequest(id: string) {
  return request<HousingRequest & { resident?: Resident }>(`/api/requests/${encodeURIComponent(id)}`);
}

export function createHousingRequest(payload: Record<string, unknown>) {
  return request<HousingRequest>("/api/requests", { method: "POST", body: payload });
}

export function setHousingRequestStatus(id: string, status: string, notes?: string) {
  return request<HousingRequest>(`/api/requests/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: { status, notes },
  });
}

export function deleteHousingRequest(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ---------------------------- Contractor requests ---------------------------- */

export function listContractorRequests(
  params: { stage?: string; contractorId?: string; requestType?: string; q?: string; page?: number; pageSize?: number } = {},
) {
  return request<
    ListResponse<ContractorRequest> & {
      data: ContractorRequest[];
      counts: Record<string, number>;
      stages: Record<string, string>;
    }
  >(`/api/contractor-requests${query(params)}`);
}

export function getContractorRequest(id: string) {
  return request<ContractorRequest>(`/api/contractor-requests/${encodeURIComponent(id)}`);
}

export function createContractorRequest(payload: Record<string, unknown>) {
  return request<ContractorRequest>("/api/contractor-requests", { method: "POST", body: payload });
}

export function approveContractorRequest(
  id: string,
  stage: string,
  payload: { employeeCode?: string; notes?: string; bedId?: string } = {},
) {
  return request<ContractorRequest>(`/api/contractor-requests/${encodeURIComponent(id)}/approve-${encodeURIComponent(stage)}`, {
    method: "POST",
    body: payload,
  });
}

export function listContractorFreeBeds(contractorId: string) {
  return request<{
    items: Array<{
      id: string;
      label: string;
      roomId: string | null;
      roomName: string;
      buildingId: string | null;
      buildingName: string;
    }>;
    total: number;
  }>(`/api/contractors/${encodeURIComponent(contractorId)}/free-beds`);
}

export function rejectContractorRequest(id: string, notes?: string) {
  return request<ContractorRequest>(`/api/contractor-requests/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body: { notes },
  });
}

export function contractorRequestPendingCounts() {
  return request<Record<string, number>>("/api/contractor-requests/pending-counts");
}

/* -------------------------------- Contractors -------------------------------- */

export function listContractors(params: { q?: string; status?: string; page?: number; pageSize?: number } = {}) {
  return request<ListResponse<Contractor> & { data?: Contractor[] }>(`/api/contractors${query(params)}`);
}

export function getContractor(id: string) {
  return request<Contractor>(`/api/contractors/${encodeURIComponent(id)}`);
}

export function contractorStats(id: string) {
  return request<ContractorStats>(`/api/contractors/${encodeURIComponent(id)}/stats`);
}

export function contractorWorkers(id: string) {
  return request<{ items: Resident[]; total: number }>(`/api/contractors/${encodeURIComponent(id)}/workers`);
}

export function createContractor(payload: Record<string, unknown>) {
  return request<Contractor>("/api/contractors", { method: "POST", body: payload });
}

export function updateContractor(id: string, payload: Record<string, unknown>) {
  return request<Contractor>(`/api/contractors/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export function deleteContractor(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/contractors/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function linkContractorWorkers(id: string, residentIds: string[]) {
  return request<{ ok: boolean; linked: number }>(`/api/contractors/${encodeURIComponent(id)}/link-workers`, {
    method: "POST",
    body: { residentIds },
  });
}

export function unlinkContractorWorker(id: string, residentId: string) {
  return request<{ ok: boolean; message: string }>(`/api/contractors/${encodeURIComponent(id)}/workers/${encodeURIComponent(residentId)}`, {
    method: "DELETE",
  });
}

export function getContractorPortal(id: string) {
  return request<ContractorPortal>(`/api/contractors/${encodeURIComponent(id)}/portal`);
}

/* -------------------------------- Operations --------------------------------- */

export type OperationsBoard = {
  date: string;
  totals: {
    housingResidents: number;
    byStatus: Record<string, number>;
    pendingContractorRequests: number;
    pendingHousingRequests: number;
  };
  groups: Record<string, Resident[]>;
  stages: Record<string, number>;
  pendingContractorRequests: ContractorRequest[];
  pendingHousingRequests: HousingRequest[];
  buildings: BuildingTree[];
  recentActivity: AuditEntry[];
};

export function getOperationsBoard(date?: string) {
  return request<OperationsBoard>(`/api/operations/board${query({ date })}`);
}

export function getOperationsAttendance(groupBy = "company", date?: string) {
  return request<AttendanceReport>(`/api/operations/attendance${query({ groupBy, date })}`);
}

export function getOperationsDuty(date?: string) {
  return request<DutyReport>(`/api/operations/duty${query({ date })}`);
}

export function getResidentsByStatus(status?: string, q?: string) {
  return request<{ items: Resident[]; total: number }>(`/api/operations/residents${query({ status, q })}`);
}

/* ---------------------------------- Reports ---------------------------------- */

export function getDashboard(date?: string) {
  return request<Dashboard>(`/api/reports/dashboard${query({ date })}`);
}

export function getAttendanceReport(groupBy = "company", date?: string) {
  return request<AttendanceReport>(`/api/reports/attendance${query({ groupBy, date })}`);
}

export type OccupancyRow = {
  id: string;
  name: string;
  location?: string;
  rooms: number;
  beds: number;
  occupied: number;
  free: number;
  percent: number;
};

export type OccupancyReport = {
  rows: OccupancyRow[];
  totals: Record<string, number>;
  buildings: BuildingTree[];
};

export function getOccupancyReport() {
  return request<OccupancyReport>("/api/reports/occupancy");
}

export type ContractorReportRow = {
  id: string;
  name: string;
  type?: string;
  status?: string;
  contactPhone?: string;
  contactEmail?: string;
  buildingNames?: string;
  workerCount: number;
  capacity: number;
  freeQuota: number;
  physicalBeds: number;
  occupiedBeds: number;
  freePhysicalBeds: number;
  occupancyPercent: number;
  pendingRequests: number;
};

export type ContractorsReport = {
  rows: ContractorReportRow[];
  summary: Record<string, number>;
};

export function getContractorsReport() {
  return request<ContractorsReport>("/api/reports/contractors");
}

export type ContractorRequestGroupRow = {
  label: string;
  total: number;
  pending: number;
  done: number;
  rejected: number;
};

export type RequestTypeRow = { label: string; total: number };

export type RequestsReport = {
  contractorRequests: {
    total: number;
    pending: number;
    done: number;
    rejected: number;
    stages: Record<string, number>;
    types: Record<string, number>;
    byContractor: ContractorRequestGroupRow[];
  };
  housingRequests: {
    total: number;
    statuses: Record<string, number>;
    types: Record<string, number>;
    byType: RequestTypeRow[];
  };
  stageLabels?: Record<string, string>;
  months?: Array<{ month: string; count: number }>;
};

export function getRequestsReport() {
  return request<RequestsReport>("/api/reports/requests");
}

export function getDutyReport(date?: string) {
  return request<DutyReport>(`/api/reports/duty${query({ date })}`);
}

export function getAttendanceGroups() {
  return request<{ rows: GroupRow[] }>("/api/reports/attendance?groupBy=company");
}

/* --------------------------------- Notifications ----------------------------- */

export function listNotifications(unreadOnly = false) {
  return request<{ items: Notification[]; total: number; unread: number }>(`/api/notifications${query({ unreadOnly })}`);
}

export function notificationUnreadCount() {
  return request<{ unread: number }>("/api/notifications/unread-count");
}

export function readNotification(id: string) {
  return request<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
}

export function readAllNotifications() {
  return request<{ ok: boolean; read: number }>("/api/notifications/read-all", { method: "POST" });
}

/* ------------------------------------ Admin ---------------------------------- */

export function adminUsers(q?: string) {
  return request<{ items: User[]; total: number }>(`/api/admin/users${query({ q })}`);
}

export function createUser(payload: Record<string, unknown>) {
  return request<User>("/api/admin/users", { method: "POST", body: payload });
}

export function updateUser(id: string, payload: Record<string, unknown>) {
  return request<User>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export function deleteUser(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function resetUserPassword(id: string, newPassword: string) {
  return request<{ ok: boolean; message: string }>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: "POST",
    body: { new_password: newPassword },
  });
}

export function checkUsername(username: string) {
  return request<{ available: boolean; username: string }>(`/api/admin/users/check${query({ username })}`);
}

export function adminPermissions() {
  return request<{ items: Array<{ id: string; label: string }>; total: number }>("/api/admin/permissions");
}

export function adminRoles() {
  return request<{ items: Role[]; total: number }>("/api/admin/roles");
}

export function createRole(payload: Record<string, unknown>) {
  return request<Role>("/api/admin/roles", { method: "POST", body: payload });
}

export function updateRole(id: string, payload: Record<string, unknown>) {
  return request<Role>(`/api/admin/roles/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export function deleteRole(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/admin/roles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getSettings() {
  return request<Settings>("/api/admin/settings");
}

export function saveSettings(payload: Partial<Settings>) {
  return request<Settings>("/api/admin/settings", { method: "PUT", body: payload });
}

export function adminAudit(params: { entity?: string; action?: string; actorId?: string; q?: string; page?: number; pageSize?: number } = {}) {
  return request<ListResponse<AuditEntry> & { data: AuditEntry[] }>(`/api/admin/audit${query(params)}`);
}

export function clearAudit() {
  return request<{ ok: boolean; deleted: number }>("/api/admin/audit", { method: "DELETE" });
}

export type BackupPayload = {
  meta: {
    app: string;
    version: string;
    exportedAt: string;
    schemaVersion: number;
    counts: Record<string, number>;
    mode: string;
  };
  data: Record<string, unknown>;
};

export function getBackup() {
  return request<BackupPayload>("/api/admin/backup");
}

export function restoreBackup(data: Record<string, unknown>, confirm = "RESTORE") {
  return request<{ ok: boolean; message: string; counts: Record<string, number> }>("/api/admin/restore", {
    method: "POST",
    body: { data, confirm },
  });
}

export function importState(data: Record<string, unknown>) {
  return request<{ ok: boolean; counts: Record<string, number> }>("/api/admin/import-state", {
    method: "POST",
    body: { data },
    timeoutMs: 120000,
  });
}

export type Diagnostics = {
  app: string;
  version: string;
  environment: string;
  serverTime: string;
  store: Record<string, unknown>;
  securityWarnings: string[];
  settings: Settings;
  counts: Record<string, number>;
  features: Record<string, boolean>;
};

export function getDiagnostics() {
  return request<Diagnostics>("/api/admin/diagnostics");
}

/* ----------------------------------- Search ---------------------------------- */

export type SearchGroupItem = { id: string; title: string; subtitle?: string; href: string };
export type SearchResult = { query: string; groups: Record<string, SearchGroupItem[]>; total: number };

export function globalSearch(q: string, limit = 8) {
  return request<SearchResult>(`/api/search${query({ q, limit })}`);
}

/* ---------------------------------- Downloads -------------------------------- */

/** ينزّل ملفاً نصياً (CSV) من الخادم مع ترويسة المصادقة. */
export async function fetchTextFile(path: string): Promise<{ content: string; filename: string }> {
  const base = baseUrl();
  const token = getToken();
  const res = await nativeRequest(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    timeoutMs: 90000,
  });
  if (!res.ok) throw new Error(`تعذر تنزيل الملف (${res.status})`);
  const content = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  const name = path.split("/").pop() || "export.csv";
  return { content, filename: name };
}

export function residentsCsvPath() {
  return "/api/residents/export.csv";
}

export function importTemplatePath() {
  return "/api/residents/import-template.csv";
}

export function usersCsvPath() {
  return "/api/admin/export/users.csv";
}

export function reportCsvPath(kind: string, date?: string) {
  return `/api/reports/export/${encodeURIComponent(kind)}.csv${query({ date })}`;
}

export function normalizeServerUrl(value: string): string {
  return normalizeBaseUrl(value);
}

export function isNative(): boolean {
  return isNativePlatform();
}
