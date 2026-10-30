export type Role = {
  id: string;
  name: string;
  description?: string;
  isSystem?: boolean;
  permissionIds?: string[];
  userCount?: number;
  createdAt?: string;
};

export type User = {
  id: string;
  name: string;
  username: string;
  role: string;
  roleId: string | null;
  roleName?: string;
  phone?: string;
  contractorId?: string | null;
  contractorName?: string;
  companyName?: string;
  department?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
  permissions?: string[];
  permissionMap?: Record<string, boolean>;
  lastLoginAt?: string;
};

export type Building = {
  id: string;
  name: string;
  location?: string;
  roomIds?: string[];
  notes?: string;
  createdAt?: string;
};

export type Room = {
  id: string;
  name: string;
  buildingId: string;
  bedIds?: string[];
  floor?: string;
  notes?: string;
  createdAt?: string;
  buildingName?: string;
  bedCount?: number;
  occupiedCount?: number;
  freeCount?: number;
};

export type Bed = {
  id: string;
  label: string;
  roomId: string;
  createdAt?: string;
  roomName?: string;
  buildingId?: string;
  buildingName?: string;
  occupied?: boolean;
  residentId?: string | null;
  residentName?: string;
  employeeCode?: string;
};

export type Resident = {
  id: string;
  employeeCode: string;
  name: string;
  jobTitle?: string;
  company?: string;
  department?: string;
  shift?: string;
  rotation?: string;
  serviceType?: string;
  baseStatus?: string;
  manualStatus?: string | null;
  buildingId?: string | null;
  roomId?: string | null;
  bedId?: string | null;
  checkInDate?: string | null;
  leaveUntil?: string | null;
  phone?: string;
  shiftTable?: string;
  dutyCycleStart?: string | null;
  dutyWorkDays?: number;
  dutyRestDays?: number;
  contractorId?: string | null;
  gender?: string;
  transportType?: string;
  departureTime?: string;
  cardNumber?: string;
  birthDate?: string | null;
  birthPlace?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  isAssigned?: boolean;
  attendanceStatus?: string;
  dutyStatus?: string;
  dutyInfo?: { status: string; day: number | null; cycle: number };
  isHousingService?: boolean;
  location?: string;
  buildingName?: string;
  roomName?: string;
  bedLabel?: string;
  age?: number | null;
  dutyLabel?: string;
};

export type HousingRequest = {
  id: string;
  requestType: string;
  residentId?: string | null;
  residentName: string;
  employeeCode?: string;
  details: string;
  priority?: string;
  status: string;
  createdAt: string;
  createdBy?: string;
  reviewedAt?: string | null;
  reviewNotes?: string;
  reviewedBy?: string;
};

export type ContractorStats = {
  workerCount: number;
  capacity: number;
  freeQuota: number;
  physicalBeds: number;
  occupiedBeds: number;
  freePhysicalBeds: number;
  occupancyPercent: number;
  buildings: number;
  pendingRequests: number;
};

export type Contractor = {
  id: string;
  name: string;
  contractorType?: string;
  department?: string;
  contactPhone?: string;
  contactEmail?: string;
  status?: string;
  buildingIds?: string[];
  buildingNames?: string[];
  bedQuota?: number;
  notes?: string;
  stats?: ContractorStats;
  createdAt?: string;
};

export type ContractorRequest = {
  id: string;
  contractorId: string;
  contractorName: string;
  requestType: "new_worker" | "remove_worker";
  workerName: string;
  employeeCode?: string;
  jobTitle?: string;
  workerCardNumber?: string;
  workerBirthDate?: string | null;
  workerBirthPlace?: string;
  buildingId?: string | null;
  bedId?: string | null;
  reason?: string;
  stage: "department" | "housing" | "security" | "visitor" | "done" | "rejected";
  createdAt: string;
  departmentApprover?: string;
  housingApprover?: string;
  securityApprover?: string;
  visitorApprover?: string;
  reviewedAt?: string | null;
  reviewNotes?: string;
  submittedBy?: string;
  history?: Array<{ at: string; action: string; stage: string; by: string; notes?: string }>;
  contractor?: { id: string; name: string; department?: string };
  stageLabel?: string;
  isAdd?: boolean;
  isPending?: boolean;
  typeLabel?: string;
  workerAge?: number | null;
  bedLabel?: string;
  roomName?: string;
};

export type ContractorWorker = {
  id: string;
  contractorId: string;
  fullName: string;
  jobTitle?: string;
  employeeCode?: string;
  status?: string;
  gateStatus?: string;
  awarenessStatus?: string;
  buildingId?: string | null;
  roomId?: string | null;
  bedId?: string | null;
  cardNumber?: string;
  birthDate?: string | null;
  birthPlace?: string;
};

export type Rotation = {
  id: string;
  bedId: string;
  outgoingResidentId: string;
  incomingResidentId: string;
  scheduledFor: string;
  status: string;
  createdAt?: string;
  createdBy?: string;
  executedAt?: string | null;
  cancelledAt?: string;
  bedLabel?: string;
  roomName?: string;
  buildingName?: string;
  outgoingName?: string;
  incomingName?: string;
};

export type Notification = {
  id: string;
  title: string;
  body?: string;
  kind?: string;
  permission?: string | null;
  link?: string;
  createdAt: string;
  actorName?: string;
  read?: boolean;
};

export type AuditEntry = {
  id: string;
  at: string;
  actorId?: string | null;
  actorName?: string;
  actorUsername?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: Record<string, unknown>;
};

export type Settings = {
  orgName?: string;
  orgSubtitle?: string;
  buildingLabel?: string;
  defaultPageSize?: number;
  lowVacancyThreshold?: number;
  notifyOnRequestStage?: boolean;
  notifyOnLowVacancy?: boolean;
  requireEmployeeCode?: boolean;
  minWorkerAge?: number;
  features?: Record<string, boolean>;
};

export type Bootstrap = {
  schemaVersion: number;
  generatedAt: string;
  user: User;
  buildings: Building[];
  rooms: Room[];
  beds: Bed[];
  residents: Resident[];
  requests: HousingRequest[];
  users: User[];
  contractors: Contractor[];
  contractorWorkers: ContractorWorker[];
  contractorRequests: ContractorRequest[];
  roles: Role[];
  rotations: Rotation[];
  settings: Settings;
  permissions: Array<{ id: string; label: string }>;
  notifications: Notification[];
  auditLog?: AuditEntry[];
  tree?: BuildingTree[];
  contractorPortal?: ContractorPortal | null;
  meta: {
    mode: string;
    serverTime: string;
    version: string;
    counts: Record<string, number>;
    pendingCounts: Record<string, number>;
    role: "staff" | "contractor";
    canViewAudit?: boolean;
    canManageUsers?: boolean;
    canManageSettings?: boolean;
  };
};

export type BuildingTree = Building & {
  rooms: Array<Room & { beds: Bed[] }>;
  roomCount: number;
  bedCount: number;
  occupiedCount: number;
  freeCount: number;
  occupancyPercent: number;
  residentCount: number;
};

export type ContractorPortal = {
  contractor: Contractor;
  workers: Resident[];
  registeredWorkers: ContractorWorker[];
  requests: ContractorRequest[];
};

export type Dashboard = {
  generatedAt: string;
  date: string;
  totals: Record<string, number>;
  requestStages: Record<string, number>;
  contractorRequestStages: Record<string, number>;
  housingRequestStatuses: Record<string, number>;
  requestStagesLabels: Record<string, string>;
  monthlyRequests: Array<{ month: string; count: number }>;
  buildings: BuildingTree[];
  contractors: Array<{
    id: string;
    name: string;
    type?: string;
    workerCount: number;
    capacity: number;
    freeQuota: number;
    physicalBeds: number;
    occupiedBeds: number;
    freePhysicalBeds: number;
    occupancyPercent: number;
    buildings: number;
    pendingRequests: number;
  }>;
  attendance: {
    byCompany: GroupRow[];
    byBuilding: GroupRow[];
    byDepartment: GroupRow[];
    byService: GroupRow[];
    byGender: GroupRow[];
  };
  recentActivity: AuditEntry[];
};

export type GroupRow = {
  label: string;
  total: number;
  present: number;
  away: number;
  leave: number;
  absent: number;
  assigned: number;
  unassigned: number;
  percent: number;
};

export type ListResponse<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
  pages?: number;
};

export type AttendanceReport = {
  date: string;
  groupBy: string;
  total: number;
  rows: GroupRow[];
  summary: Record<string, number>;
};

export type DutyReport = {
  date: string;
  rows: Array<{
    id: string;
    name: string;
    employeeCode: string;
    company: string;
    department: string;
    shift: string;
    building: string;
    room: string;
    status: string;
    workDays: number;
    restDays: number;
    cycleStart: string;
  }>;
  onDuty: DutyReport["rows"];
  onLeave: DutyReport["rows"];
  summary: Record<string, number>;
};
