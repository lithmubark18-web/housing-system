/** هل تنفذ الصفحة داخل تطبيق Capacitor (أندرويد/آيفون)؟ */
function insideNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

/**
 * يحوّل مسار التطبيق إلى مسار ملف ثابت (static export) في الإنتاج.
 * - المتصفح: مسار نظيف (/dashboard) — خادم الملفات الثابتة يخدم dashboard/index.html داخلياً.
 * - تطبيق الجوال: يُبقى /dashboard/index.html لأن خادم Capacitor يُعيد المسار المجهول إلى index.html الرئيسي.
 */
export function routePath(path: string): string {
  if (!path.startsWith("/")) return path;
  const isDev = process.env.NODE_ENV === "development";
  if (isDev || !insideNativeApp()) return path;
  const q = path.indexOf("?");
  const base = q === -1 ? path : path.slice(0, q);
  const query = q === -1 ? "" : path.slice(q);
  if (base === "/" || base.endsWith(".html")) return path;
  return `${base}/index.html${query}`;
}

/** الصفحة الرئيسية المناسبة لكل دور بعد تسجيل الدخول. */
export function homeForRole(user: { permissions?: string[]; roleId?: string | null; role?: string } | null | undefined): string {
  if (!user) return "/";
  const permissions = new Set(user.permissions || []);
  if (permissions.has("contractor.portal") && !permissions.has("dashboard.view")) return "/contractor";
  if (permissions.has("dashboard.view")) return "/dashboard";
  if (permissions.has("operations.view")) return "/operations";
  if (permissions.has("housing.view")) return "/housing";
  if (permissions.has("residents.view")) return "/residents";
  if (permissions.has("reports.view")) return "/reports";
  return "/about";
}
