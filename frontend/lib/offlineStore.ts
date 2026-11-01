import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { Bootstrap } from "./types";

/* ---------------------------------------------------------------------------
   التخزين المحلي — نسخة قراءة فقط من بيانات الخادم للعمل دون إنترنت،
   مع رمز PIN محلي (SHA-256) وجلسة محلية. لا تُخزَّن كلمات المرور إطلاقاً.
   --------------------------------------------------------------------------- */

const KEY_SESSION = "hs_session";
const KEY_PIN_PREFIX = "hs_pin_user_";
const KEY_SNAPSHOT = "hs_snapshot";
const KEY_CONFIG = "hs_config";
const KEY_PENDING = "hs_pending_queue";
/** نسخة محلية من قائمة الزوار تُملأ عند نجاح أي جلب وتُستخدم للعمل دون إنترنت */
const KEY_GUESTS = "hs_guests_cache";

/** الخادم الافتراضي للإنتاج — يُستخدم داخل APK المحمّل إن لم تُقدَّم قيمة في البناء. */
export const DEFAULT_SERVER_URL = "https://housing-system-api.onrender.com";

export type OfflineUser = {
  id: string;
  name: string;
  username: string;
  role: string;
  roleId?: string | null;
  roleName?: string;
  contractorId?: string | null;
  permissions?: string[];
  mustChangePassword?: boolean;
};

export type AppConfig = {
  server_url?: string;
  last_sync_at?: string | null;
};

export type CachedSnapshot = {
  built_at: string;
  counts: Record<string, number>;
  bootstrap: Bootstrap;
};

export type PendingAction = {
  id: string;
  path: string;
  method: string;
  body: unknown;
  created_at: string;
  label: string;
};

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function isOnline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine;
}

export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const candidates: Array<Record<string, unknown> | null> = [
    (window as unknown as { Capacitor?: Record<string, unknown> }).Capacitor || null,
    typeof Capacitor !== "undefined" ? (Capacitor as unknown as Record<string, unknown>) : null,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (typeof candidate.isNativePlatform === "function" && (candidate.isNativePlatform as () => boolean)()) return true;
      if (typeof candidate.getPlatform === "function" && (candidate.getPlatform as () => string)() !== "web") return true;
      if (candidate.isNative === true) return true;
      if (typeof candidate.platform === "string" && candidate.platform !== "web") return true;
    } catch {
      /* تجاهل */
    }
  }
  return false;
}

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function normalizeBaseUrl(url: string): string {
  const trimmed = (url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isLocalHostUrl(url: string): boolean {
  return /(^|\.)localhost$|127\.0\.0\.1|::1/.test(url.split("://").pop() || "");
}

/** هل الصفحة تعمل على خادم تطوير محلي؟ (لا يُطبّق على تطبيق Capacitor) */
export function isLocalPageHost(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativePlatform()) return false;
  const { hostname, port, protocol } = window.location;
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") return false;
  return protocol === "http:" || (port !== "" && port !== "80" && port !== "443");
}

export function getConfig(): AppConfig {
  return loadJSON<AppConfig>(KEY_CONFIG, {});
}

export function saveConfig(config: AppConfig) {
  saveJSON(KEY_CONFIG, config);
}

/** عنوان الخادم الخلفي: المحلي في التطوير، والمضبوط/البيئة في الإنتاج. */
export function backendBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const cfg = getConfig();
  const raw = normalizeBaseUrl(cfg.server_url || "");
  // عنوان الخادم المحفوظ من المستخدم له الأولوية حتى على الصفحات المحلية.
  if (raw) return raw;
  if (isLocalPageHost()) return `http://${window.location.hostname}:8444`;
  const configured = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (configured) {
    if (isLocalHostUrl(configured) && !isLocalPageHost()) {
      return `http://${window.location.hostname}:${new URL(configured).port || "8444"}`;
    }
    return normalizeBaseUrl(configured);
  }
  // داخل APK يجب ألا يكون الخادم «الجهاز نفسه» — اسقط إلى الخادم الافتراضي.
  if (isNativePlatform()) return DEFAULT_SERVER_URL;
  return window.location.origin;
}

type NativeInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

function parseNativeResponse(res: { status?: number; data?: unknown }): { status: number; ok: boolean; data: unknown } {
  let parsed = res.data;
  if (typeof res.data === "string") {
    try {
      parsed = JSON.parse(res.data);
    } catch {
      parsed = res.data;
    }
  }
  const status = res.status ?? 0;
  return { status, ok: status >= 200 && status < 300, data: parsed };
}

/** طلب HTTP يعمل في المتصفح وCapacitor (لتفادي قيود CORS داخل التطبيق). */
export async function nativeRequest(
  input: string,
  init: NativeInit = {},
): Promise<{ status: number; ok: boolean; data: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers || {}) };
  const body = init.body !== undefined ? (typeof init.body === "string" ? init.body : JSON.stringify(init.body)) : undefined;
  const timeout = init.timeoutMs ?? 60000;
  const method = (init.method || "GET").toUpperCase();

  if (isNativePlatform()) {
    if (method === "GET" || method === "DELETE") {
      const res = await CapacitorHttp.request({
        url: input,
        method,
        headers,
        connectTimeout: timeout,
        readTimeout: timeout,
      });
      return parseNativeResponse(res);
    }
    const res = await CapacitorHttp.request({
      url: input,
      method,
      headers,
      data: body,
      connectTimeout: timeout,
      readTimeout: timeout,
    });
    return parseNativeResponse(res);
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const res = await fetch(input, {
      method,
      headers,
      body,
      signal: controller ? controller.signal : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, ok: res.ok, data };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------------- الجلسة -------------------------------- */

export function loadLocalSession(): OfflineUser | null {
  return loadJSON<OfflineUser | null>(KEY_SESSION, null);
}

export function storeLocalSession(user: OfflineUser) {
  saveJSON(KEY_SESSION, user);
}

export function clearLocalSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_SESSION);
}

export async function sha256Hex(text: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${text}::${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pinKey(username: string): string {
  return KEY_PIN_PREFIX + encodeURIComponent(username.toLowerCase());
}

export async function setLocalPin(pin: string, username: string) {
  const salt = uuid().slice(0, 12);
  saveJSON(pinKey(username), { salt, hash: await sha256Hex(pin, salt) });
}

export async function verifyLocalPin(pin: string, username: string): Promise<boolean> {
  const record = loadJSON<{ salt: string; hash: string } | null>(pinKey(username), null);
  if (!record) return false;
  return (await sha256Hex(pin, record.salt)) === record.hash;
}

export function hasLocalPin(username: string): boolean {
  return !!loadJSON<{ salt: string; hash: string } | null>(pinKey(username), null);
}

export function clearLocalPin(username: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(pinKey(username));
}

/* تذكُّر قرار المستخدم بالتخلي عن رمز PIN حتى لا تُعرض شاشة الضبط في كل دخول */
const KEY_PIN_SKIP_PREFIX = "hs_pin_skip_";

export function hasPinSkip(username: string): boolean {
  return loadJSON<boolean>(`${KEY_PIN_SKIP_PREFIX}${encodeURIComponent(username.toLowerCase())}`, false) === true;
}

export function setPinSkip(username: string) {
  saveJSON(`${KEY_PIN_SKIP_PREFIX}${encodeURIComponent(username.toLowerCase())}`, true);
}

export function clearPinSkip(username: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${KEY_PIN_SKIP_PREFIX}${encodeURIComponent(username.toLowerCase())}`);
}

/* ------------------------------- اللقطة -------------------------------- */

let snapshotMemory: CachedSnapshot | null = null;

function slimBootstrap(bootstrap: Bootstrap): Bootstrap {
  const residents = Array.isArray(bootstrap.residents) ? bootstrap.residents : [];
  return {
    ...bootstrap,
    residents: residents.slice(0, 900).map((r) => ({
      ...r,
      notes: undefined,
      shiftTable: undefined,
    })),
    auditLog: undefined,
    notifications: (bootstrap.notifications || []).slice(0, 60),
    users: (bootstrap.users || []).map((u) => ({ ...u })),
  };
}

export function saveCachedSnapshot(bootstrap: Bootstrap, counts?: Record<string, number>): boolean {
  const snapshot: CachedSnapshot = {
    built_at: new Date().toISOString(),
    counts: counts || bootstrap.meta?.counts || {},
    bootstrap,
  };
  snapshotMemory = snapshot;
  if (saveJSON(KEY_SNAPSHOT, snapshot)) return true;
  const slim: CachedSnapshot = {
    ...snapshot,
    bootstrap: slimBootstrap(bootstrap),
  };
  if (saveJSON(KEY_SNAPSHOT, slim)) return true;
  try {
    window.localStorage.removeItem(KEY_SNAPSHOT);
  } catch {
    /* تجاهل */
  }
  return false;
}

export function getCachedSnapshot(): CachedSnapshot | null {
  if (snapshotMemory) return snapshotMemory;
  const cached = loadJSON<CachedSnapshot | null>(KEY_SNAPSHOT, null);
  if (cached && cached.bootstrap) {
    snapshotMemory = cached;
    return cached;
  }
  return null;
}

export function clearCachedSnapshot() {
  snapshotMemory = null;
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_SNAPSHOT);
}

/* --------------------------- الدخول عبر الشبكة --------------------------- */

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function tryOnlineLogin(
  username: string,
  password: string,
): Promise<{ ok: true; user: OfflineUser } | { ok: false; code: "unauthorized" | "unreachable"; detail?: string }> {
  const base = backendBaseUrl();
  if (!base) return { ok: false, code: "unreachable", detail: "no-base-url" };
  let lastDetail = "no-response";
  // إعادة المحاولة مرة واحدة: الخادم المجاني يستغرق وقتاً في الإقلاع البارد.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await nativeRequest(`${base}/api/auth/login`, {
        method: "POST",
        body: { username, password },
        timeoutMs: 60000,
      });
      if (res.ok && res.data && typeof res.data === "object") {
        const payload = res.data as {
          access_token?: string;
          refresh_token?: string;
          user?: OfflineUser;
        };
        if (payload.user && payload.access_token) {
          if (typeof window !== "undefined") {
            window.localStorage.setItem("access_token", payload.access_token);
            if (payload.refresh_token) window.localStorage.setItem("refresh_token", payload.refresh_token);
            window.localStorage.setItem("user", JSON.stringify(payload.user));
          }
          storeLocalSession(payload.user);
          return { ok: true, user: payload.user };
        }
        return { ok: false, code: "unreachable", detail: "invalid-response" };
      }
      if (res.status === 401) return { ok: false, code: "unauthorized" };
      lastDetail = `status=${res.status} native=${isNativePlatform()}`;
    } catch (error) {
      lastDetail = `err=${error instanceof Error ? error.message : String(error)} native=${isNativePlatform()}`;
    }
    if (attempt === 0) await sleep(1800);
  }
  return { ok: false, code: "unreachable", detail: `${base} | ${lastDetail}` };
}

/* ------------------------- طابور الإجراءات المعلّقة ------------------------ */

export function getPendingActions(): PendingAction[] {
  return loadJSON<PendingAction[]>(KEY_PENDING, []);
}

export function queuePendingAction(action: Omit<PendingAction, "id" | "created_at">) {
  const list = getPendingActions();
  list.push({ ...action, id: uuid(), created_at: new Date().toISOString() });
  saveJSON(KEY_PENDING, list.slice(-200));
}

export function clearPendingActions() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_PENDING);
}

export function setPendingActions(list: PendingAction[]) {
  saveJSON(KEY_PENDING, list.slice(-200));
}

/* ------------------------------ ذاكرة الزوار ------------------------------ */

export function getGuestsCache<T>(): T[] {
  return loadJSON<T[]>(KEY_GUESTS, []);
}

export function saveGuestsCache<T>(list: T[]) {
  saveJSON(KEY_GUESTS, (list || []).slice(-500));
}

export function clearGuestsCache() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_GUESTS);
}

export function pinHint(username: string): boolean {
  return hasLocalPin(username);
}
