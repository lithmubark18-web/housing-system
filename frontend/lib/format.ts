const AR = "ar-EG";

export function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatNumber(value: unknown): string {
  return new Intl.NumberFormat(AR).format(num(value));
}

export function formatPercent(value: unknown): string {
  return `${new Intl.NumberFormat(AR, { maximumFractionDigits: 1 }).format(num(value))}%`;
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(AR, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(AR, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function timeAgo(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return formatDate(value);
}

export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function ageFrom(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  const age = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return age >= 0 && age < 120 ? age : null;
}

export function initials(name?: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "؟";
  return parts.slice(0, 2).map((p) => p[0]).join("");
}

/** ألوان وتسميات الحالات — تدعم حالات السكان وطلبات المتعهدين. */
export type Tone = "good" | "bad" | "warn" | "info" | "muted";

const STATUS_TONES: Record<string, Tone> = {
  حاضر: "good",
  "في إجازة": "warn",
  إجازة: "warn",
  "غير مسكن": "muted",
  "غير محدد": "muted",
  done: "good",
  rejected: "bad",
  housing: "info",
  security: "warn",
  visitor: "info",
  pending: "warn",
  "قيد المراجعة": "warn",
  "تمت الموافقة": "good",
  "مرفوض": "bad",
  "مكتمل": "good",
  "قيد التنفيذ": "info",
  نشط: "good",
  موقوف: "bad",
  inactive: "bad",
  active: "good",
  scheduled: "warn",
  executed: "good",
  cancelled: "bad",
};

export function statusTone(status?: string | null): Tone {
  if (!status) return "muted";
  const key = status.trim();
  if (STATUS_TONES[key]) return STATUS_TONES[key];
  if (/مرفوض|موقوف|ملغ/.test(key)) return "bad";
  if (/مراجعة|انتظار|معلّق|معلق|مجدول|إجازة/.test(key)) return "warn";
  if (/تم|مكتمل|نشط|حاضر|منفذ|موافق/.test(key)) return "good";
  return "info";
}

export function toneClass(tone: Tone): string {
  return `status status-${tone}`;
}

export const STAGE_LABELS: Record<string, string> = {
  department: "اعتماد الإدارة",
  housing: "اعتماد السكن",
  security: "الاعتماد الأمني",
  visitor: "اعتماد الزوار",
  done: "مكتمل",
  rejected: "مرفوض",
};

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  new_worker: "إضافة عامل",
  remove_worker: "استبعاد عامل",
  إضافة: "إضافة",
  استبعاد: "استبعاد",
};

export const HOUSING_REQUEST_TYPE_LABELS: Record<string, string> = {
  housing: "طلب سكن",
  maintenance: "صيانة",
  transfer: "نقل سكن",
  leave: "مغادرة/إجازة",
  other: "أخرى",
};

export function stageLabel(stage?: string | null): string {
  if (!stage) return "—";
  return STAGE_LABELS[stage] || stage;
}

export function requestTypeLabel(type?: string | null): string {
  if (!type) return "—";
  return REQUEST_TYPE_LABELS[type] || type;
}

export function attendanceLabel(status?: string | null): string {
  return status || "غير محدد";
}

export function truncate(text: string, max = 60): string {
  const value = text || "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
