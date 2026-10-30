"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileJson,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  UsersRound,
} from "lucide-react";
import {
  adminAudit,
  adminPermissions,
  adminRoles,
  adminUsers,
  clearAudit,
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  fetchTextFile,
  getBackup,
  getDiagnostics,
  importState,
  resetUserPassword,
  restoreBackup,
  updateRole,
  updateUser,
  usersCsvPath,
  type Diagnostics,
} from "@/lib/api";
import { downloadContent, downloadCsv } from "@/lib/export";
import { formatDate, formatDateTime, formatNumber, timeAgo, todayISO } from "@/lib/format";
import { routePath } from "@/lib/nav";
import { can, roleLabel } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { AuditEntry, Role, User } from "@/lib/types";
import {
  Alert,
  Badge,
  Divider,
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

type TabId = "users" | "roles" | "audit" | "backup" | "diagnostics";

const ROLE_PERMISSION_GROUPS: Record<string, string> = {
  dashboard: "لوحة المعلومات",
  residents: "السكان",
  housing: "السكن",
  operations: "المتابعة",
  requests: "الطلبات",
  contractors: "المتعهدون",
  reports: "التقارير",
  admin: "الإدارة",
  audit: "سجل العمليات",
};

const ENTITY_OPTIONS = [
  { value: "", label: "كل الكيانات" },
  { value: "user", label: "المستخدمون" },
  { value: "role", label: "الأدوار" },
  { value: "resident", label: "السكان" },
  { value: "building", label: "المباني" },
  { value: "room", label: "الغرف" },
  { value: "bed", label: "الأسرّة" },
  { value: "contractor", label: "المتعهدون" },
  { value: "request", label: "طلبات السكن" },
  { value: "contractor_request", label: "طلبات المتعهدين" },
  { value: "settings", label: "الإعدادات" },
  { value: "system", label: "النظام" },
  { value: "audit", label: "السجل" },
];

const EMPTY_USER = {
  name: "",
  username: "",
  password: "",
  roleId: "r_housing",
  phone: "",
  contractorId: "",
  department: "",
  isActive: true,
  mustChangePassword: false,
};

/* إدارات المتعهدين — مطابقة لـ CONTRACTOR_DEPARTMENTS في الخادم */
const DEPARTMENT_OPTIONS = [
  { value: "إدارة الشؤون", label: "إدارة الشؤون" },
  { value: "إدارة التخطيط", label: "إدارة التخطيط" },
  { value: "إدارة التعبئة", label: "إدارة التعبئة" },
  { value: "إدارة الصيانة", label: "إدارة الصيانة" },
];

export default function AdminPage() {
  const { data, user, offline, online, reload } = useApp();
  const canUsers = can(user, "admin.users");
  const canSettings = can(user, "admin.settings");
  const canAudit = can(user, "audit.view");
  const canBackup = can(user, "admin.backup");

  const tabs = useMemo(() => {
    const list: Array<{ id: TabId; label: string }> = [];
    if (canUsers) {
      list.push({ id: "users", label: "المستخدمون" });
      list.push({ id: "roles", label: "الأدوار والصلاحيات" });
    }
    if (canAudit) list.push({ id: "audit", label: "سجل العمليات" });
    if (canBackup) list.push({ id: "backup", label: "النسخ الاحتياطي" });
    if (canSettings) list.push({ id: "diagnostics", label: "التشخيص" });
    return list;
  }, [canUsers, canAudit, canBackup, canSettings]);

  const [tab, setTab] = useState<TabId>(tabs[0]?.id || "audit");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /* ------------------------------- المستخدمون ------------------------------ */
  const [userQuery, setUserQuery] = useState("");
  const [userFormOpen, setUserFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userDraft, setUserDraft] = useState({ ...EMPTY_USER });
  const [userFormError, setUserFormError] = useState("");

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");

  /* --------------------------------- الأدوار -------------------------------- */
  const [roleFormOpen, setRoleFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleDraft, setRoleDraft] = useState({ name: "", description: "", permissionIds: [] as string[] });
  const [roleFormError, setRoleFormError] = useState("");
  const [permissions, setPermissions] = useState<Array<{ id: string; label: string }>>([]);

  /* ------------------------------ سجل العمليات ----------------------------- */
  const [auditRows, setAuditRows] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPages, setAuditPages] = useState(1);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditEntity, setAuditEntity] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");

  /* ------------------------------- النسخ الاحتياطي ---------------------------- */
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagError, setDiagError] = useState("");
  const [restoreFile, setRestoreFile] = useState("");
  const [restorePayload, setRestorePayload] = useState<Record<string, unknown> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const roleOptions = useMemo(
    () => (data?.roles || []).map((role) => ({ value: role.id, label: role.name })),
    [data],
  );
  const contractorOptions = useMemo(
    () => (data?.contractors || []).map((contractor) => ({ value: contractor.id, label: contractor.name })),
    [data],
  );
  const userCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const account of data?.users || []) {
      const key = account.roleId || "";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [data]);

  const filteredUsers = useMemo(() => {
    const needle = userQuery.trim().toLowerCase();
    return (data?.users || []).filter((account) => {
      if (!needle) return true;
      return [account.name, account.username, account.phone, account.roleName, account.contractorName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data, userQuery]);

  const permissionGroups = useMemo(() => {
    const map = new Map<string, Array<{ id: string; label: string }>>();
    for (const permission of permissions) {
      const prefix = permission.id.split(".")[0];
      const list = map.get(prefix) || [];
      list.push(permission);
      map.set(prefix, list);
    }
    return Array.from(map.entries());
  }, [permissions]);

  useEffect(() => {
    if (!tabs.length) return;
    if (!tabs.some((item) => item.id === tab)) setTab(tabs[0].id);
  }, [tabs, tab]);

  useEffect(() => {
    if (!canUsers) return;
    adminPermissions()
      .then((res) => setPermissions(res.items))
      .catch(() => setPermissions(data?.permissions || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUsers]);

  useEffect(() => {
    if (tab !== "audit" || !canAudit || !online || offline) return;
    let cancelled = false;
    setAuditLoading(true);
    adminAudit({ q: auditQuery, entity: auditEntity, page: auditPage, pageSize: 40 })
      .then((res) => {
        if (cancelled) return;
        setAuditRows(res.items || res.data || []);
        setAuditTotal(res.total);
        setAuditPages(res.pages || Math.max(1, Math.ceil(res.total / 40)));
        setAuditError("");
      })
      .catch((err) => {
        if (!cancelled) setAuditError(err instanceof Error ? err.message : "تعذر تحميل السجل");
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, canAudit, online, offline, auditQuery, auditEntity, auditPage]);

  useEffect(() => {
    if ((tab !== "diagnostics" && tab !== "backup") || !canSettings || !online || offline) return;
    let cancelled = false;
    getDiagnostics()
      .then((res) => {
        if (!cancelled) {
          setDiagnostics(res);
          setDiagError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setDiagError(err instanceof Error ? err.message : "تعذر تحميل التشخيص");
      });
    return () => {
      cancelled = true;
    };
  }, [tab, canSettings, online, offline]);

  function notify(message: string) {
    setNotice(message);
    setError("");
    window.setTimeout(() => setNotice(""), 5000);
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "تعذر تنفيذ الإجراء");
  }

  /* -------------------------------- المستخدمون ------------------------------ */

  function openCreateUser() {
    setEditingUser(null);
    setUserDraft({ ...EMPTY_USER, roleId: roleOptions[0]?.value || "r_housing" });
    setUserFormError("");
    setUserFormOpen(true);
  }

  function openEditUser(account: User) {
    setEditingUser(account);
    setUserDraft({
      name: account.name || "",
      username: account.username || "",
      password: "",
      roleId: account.roleId || roleOptions[0]?.value || "r_housing",
      phone: account.phone || "",
      contractorId: account.contractorId || "",
      department: account.department || "",
      isActive: account.isActive !== false,
      mustChangePassword: !!account.mustChangePassword,
    });
    setUserFormError("");
    setUserFormOpen(true);
  }

  async function saveUser() {
    if (!userDraft.name.trim()) return setUserFormError("الاسم مطلوب");
    if (!userDraft.username.trim()) return setUserFormError("اسم المستخدم مطلوب");
    if (!editingUser && userDraft.password.length < 6) return setUserFormError("كلمة المرور 6 أحرف على الأقل");
    if (editingUser && userDraft.password && userDraft.password.length < 6) return setUserFormError("كلمة المرور 6 أحرف على الأقل");
    if (userDraft.roleId === "r_contractor" && !userDraft.contractorId) return setUserFormError("اربط حساب المتعهد بمتعهد");
    if (userDraft.roleId === "r_dept_manager" && !userDraft.department) return setUserFormError("اختر إدارة مدير الإدارة");
    setBusy(true);
    setUserFormError("");
    try {
      const payload: Record<string, unknown> = {
        name: userDraft.name.trim(),
        username: userDraft.username.trim(),
        roleId: userDraft.roleId,
        phone: userDraft.phone.trim(),
        isActive: userDraft.isActive,
        mustChangePassword: userDraft.mustChangePassword,
        contractorId: userDraft.roleId === "r_contractor" ? userDraft.contractorId : null,
        department: userDraft.roleId === "r_dept_manager" ? userDraft.department : "",
      };
      if (userDraft.password) payload.password = userDraft.password;
      if (editingUser) await updateUser(editingUser.id, payload);
      else await createUser(payload);
      setUserFormOpen(false);
      await reload();
      notify(editingUser ? "تم تحديث بيانات المستخدم" : "تم إنشاء المستخدم");
    } catch (err) {
      setUserFormError(err instanceof Error ? err.message : "تعذر حفظ المستخدم");
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(account: User) {
    if (!window.confirm(`حذف المستخدم ${account.username}؟ لا يمكن التراجع.`)) return;
    setBusy(true);
    try {
      await deleteUser(account.id);
      await reload();
      notify("تم حذف المستخدم");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveReset() {
    if (!resetTarget) return;
    if (resetPassword.length < 6) return setResetError("كلمة المرور 6 أحرف على الأقل");
    setBusy(true);
    setResetError("");
    try {
      await resetUserPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword("");
      await reload();
      notify("تم إعادة تعيين كلمة المرور");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "تعذر إعادة التعيين");
    } finally {
      setBusy(false);
    }
  }

  async function exportUsers() {
    setBusy(true);
    try {
      const file = await fetchTextFile(usersCsvPath());
      downloadCsv(`users-${todayISO()}.csv`, file.content);
      notify("تم تصدير المستخدمين");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  /* --------------------------------- الأدوار -------------------------------- */

  function openCreateRole() {
    setEditingRole(null);
    setRoleDraft({ name: "", description: "", permissionIds: [] });
    setRoleFormError("");
    setRoleFormOpen(true);
  }

  function openEditRole(role: Role) {
    setEditingRole(role);
    setRoleDraft({ name: role.name, description: role.description || "", permissionIds: role.permissionIds || [] });
    setRoleFormError("");
    setRoleFormOpen(true);
  }

  async function saveRole() {
    if (!roleDraft.name.trim()) return setRoleFormError("اسم الدور مطلوب");
    if (!roleDraft.permissionIds.length) return setRoleFormError("اختر صلاحية واحدة على الأقل");
    setBusy(true);
    setRoleFormError("");
    try {
      const payload = {
        name: roleDraft.name.trim(),
        description: roleDraft.description.trim(),
        permissionIds: roleDraft.permissionIds,
      };
      if (editingRole) await updateRole(editingRole.id, payload);
      else await createRole(payload);
      setRoleFormOpen(false);
      await reload();
      notify(editingRole ? "تم تحديث الدور" : "تم إنشاء الدور");
    } catch (err) {
      setRoleFormError(err instanceof Error ? err.message : "تعذر حفظ الدور");
    } finally {
      setBusy(false);
    }
  }

  async function removeRole(role: Role) {
    if (!window.confirm(`حذف الدور ${role.name}؟`)) return;
    setBusy(true);
    try {
      await deleteRole(role.id);
      await reload();
      notify("تم حذف الدور");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------- سجل العمليات ----------------------------- */

  async function clearLog() {
    if (!window.confirm("مسح سجل العمليات بالكامل؟ لا يمكن التراجع.")) return;
    setBusy(true);
    try {
      const res = await clearAudit();
      setAuditRows([]);
      setAuditTotal(0);
      await reload();
      notify(`تم مسح ${formatNumber(res.deleted)} سجلاً`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------- النسخ الاحتياطي ---------------------------- */

  async function downloadBackup() {
    setBusy(true);
    try {
      const payload = await getBackup();
      downloadContent(`housing-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json", false);
      notify("تم تنزيل النسخة الاحتياطية");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File): Promise<Record<string, unknown> | null> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("الملف لا يحتوي كائناً صالحاً");
      return parsed as Record<string, unknown>;
    } catch (err) {
      setError(err instanceof Error ? `تعذر قراءة الملف: ${err.message}` : "تعذر قراءة الملف");
      return null;
    }
  }

  async function onRestoreFile(file: File) {
    const parsed = await readFile(file);
    if (!parsed) return;
    setRestoreFile(file.name);
    setRestorePayload(parsed);
  }

  async function confirmRestore() {
    if (!restorePayload) return;
    const confirmText = window.prompt("اكتب RESTORE لتأكيد استعادة النسخة الاحتياطية:");
    if (!confirmText || confirmText.trim().toUpperCase() !== "RESTORE") {
      setError("ألغيت الاستعادة — يجب كتابة RESTORE");
      return;
    }
    setBusy(true);
    try {
      const result = await restoreBackup(restorePayload, "RESTORE");
      setRestorePayload(null);
      setRestoreFile("");
      await reload();
      notify(result.message || "تمت الاستعادة");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onImportFile(file: File) {
    const parsed = await readFile(file);
    if (!parsed) return;
    if (!window.confirm("استيراد ملف حالة كامل؟ سيستبدل البيانات الحالية.")) return;
    setBusy(true);
    try {
      const result = await importState(parsed);
      await reload();
      notify(`تم الاستيراد — ${formatNumber(result.counts.residents || 0)} ساكن`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  if (!data) return <Loader label="جارٍ تحميل الإدارة..." />;

  if (!tabs.length) {
    return (
      <>
        <PageHead eyebrow="إدارة النظام" title="غير مصرّح" />
        <Alert tone="warning">لا تملك صلاحية الوصول إلى إدارة النظام.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="إدارة النظام"
        title="المستخدمون والصلاحيات والنظام"
        subtitle={`${formatNumber((data.users || []).length)} مستخدم · ${formatNumber((data.roles || []).length)} دور · ${formatNumber(data.meta?.counts?.audit || 0)} عملية مسجلة`}
        actions={
          <div className="head-actions">
            <button type="button" className="secondary-btn" onClick={() => reload()} disabled={busy}>
              <RefreshCw size={16} /> تحديث
            </button>
            {canSettings && (
              <a className="primary-btn" href={routePath("/settings")}>
                <Settings size={16} /> إعدادات النظام
              </a>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorNote message={error} />
      {offline && <Alert tone="warning">وضع دون إنترنت: عرض فقط، والإجراءات معطلة.</Alert>}

      <Tabs tabs={tabs.map((item) => ({ ...item }))} active={tab} onChange={setTab} />

      {/* -------------------------------- المستخدمون ------------------------------ */}
      {tab === "users" && (
        <>
          <div className="stats-grid stats-grid-4">
            <StatCard icon={UsersRound} label="المستخدمون" value={formatNumber((data.users || []).length)} hint={`${formatNumber((data.users || []).filter((item) => item.isActive !== false).length)} نشط`} />
            <StatCard icon={ShieldCheck} label="مديرو النظام" value={formatNumber((data.users || []).filter((item) => item.roleId === "r_admin").length)} tone="warn" />
            <StatCard icon={UserCog} label="حسابات المتعهدين" value={formatNumber((data.users || []).filter((item) => item.roleId === "r_contractor").length)} tone="info" />
            <StatCard icon={KeyRound} label="بحاجة لتغيير كلمة المرور" value={formatNumber((data.users || []).filter((item) => item.mustChangePassword).length)} tone="danger" />
          </div>

          <section className="form-panel filters-panel">
            <div className="filters-row">
              <SearchInput value={userQuery} onChange={setUserQuery} placeholder="بحث بالاسم أو اسم المستخدم أو الجوال..." />
              <div className="filters-spacer" />
              <button type="button" className="secondary-btn" onClick={exportUsers} disabled={busy || offline}>
                <Download size={16} /> تصدير CSV
              </button>
              <button type="button" className="primary-btn" onClick={openCreateUser} disabled={offline}>
                <Plus size={16} /> مستخدم جديد
              </button>
            </div>
            <div className="filters-foot">
              <span>النتائج: <strong>{formatNumber(filteredUsers.length)}</strong> من {formatNumber((data.users || []).length)}</span>
            </div>
          </section>

          <section className="table-card">
            {filteredUsers.length ? (
              <div className="table-scroll">
                <table className="residents-table">
                  <thead>
                    <tr><th>المستخدم</th><th>اسم الدخول</th><th>الدور</th><th>الإدارة</th><th>الجوال</th><th>المتعهد</th><th>آخر دخول</th><th>الحالة</th><th>إجراءات</th></tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((account) => (
                      <tr key={account.id}>
                        <td><strong>{account.name}</strong>{account.mustChangePassword && <small className="block-note warn-note">يجب تغيير كلمة المرور</small>}</td>
                        <td><code className="code-chip">{account.username}</code></td>
                        <td><Badge tone={account.roleId === "r_admin" ? "warn" : "info"}>{account.roleName || roleLabel(account.roleId, account.role)}</Badge></td>
                        <td>{account.roleId === "r_dept_manager" ? (account.department || "—") : "—"}</td>
                        <td>{account.phone || "—"}</td>
                        <td>{account.contractorName || "—"}</td>
                        <td>{account.lastLoginAt ? timeAgo(account.lastLoginAt) : "لم يدخل"}</td>
                        <td><Badge tone={account.isActive === false ? "bad" : "good"}>{account.isActive === false ? "معطّل" : "نشط"}</Badge></td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="icon-plain" title="تعديل" onClick={() => openEditUser(account)} disabled={offline}>
                              <Pencil size={16} />
                            </button>
                            <button type="button" className="icon-plain" title="إعادة تعيين كلمة المرور" onClick={() => { setResetTarget(account); setResetPassword(""); setResetError(""); }} disabled={offline}>
                              <KeyRound size={16} />
                            </button>
                            <button type="button" className="icon-plain danger" title="حذف" onClick={() => removeUser(account)} disabled={offline || busy || account.id === user?.id}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="لا يوجد مستخدمون مطابقون" hint="جرّب تغيير البحث" />
            )}
          </section>
        </>
      )}

      {/* -------------------------------- الأدوار -------------------------------- */}
      {tab === "roles" && (
        <>
          <div className="section-head-actions">
            <SectionIntro title="الأدوار والصلاحيات" hint="حدد الصلاحيات الدقيقة لكل دور — تُطبّق فوراً على المستخدمين" />
            <button type="button" className="primary-btn" onClick={openCreateRole} disabled={offline}>
              <Plus size={16} /> دور جديد
            </button>
          </div>

          <div className="roles-grid">
            {(data.roles || []).map((role) => (
              <article className="role-card" key={role.id}>
                <div className="role-card-head">
                  <div>
                    <h3>{role.name}</h3>
                    <p>{role.description || "بدون وصف"}</p>
                  </div>
                  <Badge tone={role.id === "r_admin" ? "warn" : "info"}>{formatNumber(userCounts.get(role.id) || 0)} مستخدم</Badge>
                </div>
                <div className="chip-row">
                  {(role.permissionIds || []).slice(0, 6).map((id) => (
                    <span className="mini-chip" key={id}>{permissions.find((permission) => permission.id === id)?.label || id}</span>
                  ))}
                  {(role.permissionIds || []).length > 6 && <span className="mini-chip">+{(role.permissionIds || []).length - 6}</span>}
                  {!(role.permissionIds || []).length && <span className="muted">لا توجد صلاحيات</span>}
                </div>
                <div className="row-actions">
                  <button type="button" className="secondary-btn" onClick={() => openEditRole(role)} disabled={offline}>
                    <Pencil size={15} /> تعديل
                  </button>
                  <button type="button" className="danger-btn" onClick={() => removeRole(role)} disabled={offline || busy || role.isSystem || role.id === "r_admin"}>
                    <Trash2 size={15} /> حذف
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {/* ------------------------------ سجل العمليات ----------------------------- */}
      {tab === "audit" && (
        <>
          <section className="form-panel filters-panel">
            <div className="filters-row">
              <SearchInput value={auditQuery} onChange={(value) => { setAuditQuery(value); setAuditPage(1); }} placeholder="بحث في السجل..." />
              <Select
                value={auditEntity}
                onChange={(event) => { setAuditEntity(event.target.value); setAuditPage(1); }}
                options={ENTITY_OPTIONS}
              />
              <div className="filters-spacer" />
              <button type="button" className="danger-btn" onClick={clearLog} disabled={offline || busy || !auditTotal}>
                <Trash2 size={16} /> مسح السجل
              </button>
            </div>
            <div className="filters-foot">
              <span>الإجمالي: <strong>{formatNumber(auditTotal)}</strong> عملية</span>
            </div>
          </section>

          {auditError && <ErrorNote message={auditError} />}
          {auditLoading ? (
            <Loader label="جارٍ تحميل السجل..." />
          ) : (
            <section className="table-card">
              {auditRows.length ? (
                <div className="table-scroll">
                  <table className="compact-table">
                    <thead>
                      <tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>الكيان</th><th>المعرّف</th><th>التفاصيل</th></tr>
                    </thead>
                    <tbody>
                      {auditRows.map((entry) => (
                        <tr key={entry.id}>
                          <td><span title={formatDateTime(entry.at)}>{formatDate(entry.at)}</span><small className="block-note">{timeAgo(entry.at)}</small></td>
                          <td><strong>{entry.actorName || entry.actorUsername || "النظام"}</strong></td>
                          <td><span className="code-chip">{entry.action}</span></td>
                          <td>{entry.entity}</td>
                          <td>{entry.entityId || "—"}</td>
                          <td><small className="muted wrap-text">{entry.details ? JSON.stringify(entry.details) : "—"}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="لا توجد عمليات مسجّلة" hint="ستظهر العمليات هنا بمجرد تنفيذ إجراءات" />
              )}
              <Pagination page={auditPage} pages={auditPages} total={auditTotal} onPage={setAuditPage} />
            </section>
          )}
        </>
      )}

      {/* ----------------------------- النسخ الاحتياطي ---------------------------- */}
      {tab === "backup" && (
        <>
          <div className="dash-grid">
            <section className="form-panel">
              <div className="panel-title">
                <div>
                  <h2>تنزيل نسخة احتياطية</h2>
                  <span>ملف JSON يحتوي كل البيانات والإعدادات والمستخدمين</span>
                </div>
                <DatabaseBackup size={22} />
              </div>
              <p className="muted">
                أنشئ نسخة كاملة قبل أي تعديل كبير. يمكن استعادتها لاحقاً أو استخدامها في بيئة أخرى.
              </p>
              <div className="row-actions">
                <button type="button" className="primary-btn" onClick={downloadBackup} disabled={busy || offline}>
                  <Download size={16} /> تنزيل النسخة ({formatNumber(data.meta?.counts?.residents || 0)} ساكن)
                </button>
              </div>
            </section>

            <section className="form-panel">
              <div className="panel-title">
                <div>
                  <h2>استعادة نسخة احتياطية</h2>
                  <span>يستبدل البيانات الحالية بالكامل — يتطلب تأكيد RESTORE</span>
                </div>
                <Upload size={22} />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onRestoreFile(file);
                  event.target.value = "";
                }}
              />
              <p className="muted">اختر ملف نسخة احتياطية بصيغة JSON. تحقق من التاريخ والحجم قبل الاستعادة.</p>
              <div className="row-actions">
                <button type="button" className="secondary-btn" onClick={() => fileRef.current?.click()} disabled={busy || offline}>
                  <FileJson size={16} /> اختيار ملف
                </button>
                {restorePayload && (
                  <button type="button" className="danger-btn" onClick={confirmRestore} disabled={busy || offline}>
                    <Upload size={16} /> استعادة {restoreFile}
                  </button>
                )}
              </div>
              {restorePayload && (
                <Alert tone="warning">
                  سيتم استبدال البيانات الحالية بمحتوى الملف. تأكد من وجود نسخة حديثة قبل المتابعة.
                </Alert>
              )}
            </section>
          </div>

          <section className="form-panel">
            <div className="panel-title">
              <div>
                <h2>استيراد ملف حالة (Seed)</h2>
                <span>لاستيراد بيانات خام من نظام سابق — يُستبدل المخزن بالكامل</span>
              </div>
              <Upload size={22} />
            </div>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportFile(file);
                event.target.value = "";
              }}
            />
            <div className="row-actions">
              <button type="button" className="secondary-btn" onClick={() => importRef.current?.click()} disabled={busy || offline}>
                <Upload size={16} /> اختيار ملف Seed
              </button>
            </div>
          </section>

          <section className="form-panel">
            <div className="panel-title">
              <div>
                <h2>أحجام البيانات الحالية</h2>
                <span>{data.meta?.mode === "postgres" ? "PostgreSQL / Supabase" : "تخزين JSON محلي"}</span>
              </div>
            </div>
            <InfoGrid
              items={Object.entries(data.meta?.counts || {}).map(([key, value]) => ({ label: key, value: formatNumber(value) }))}
            />
          </section>
        </>
      )}

      {/* -------------------------------- التشخيص -------------------------------- */}
      {tab === "diagnostics" && (
        <>
          {diagError && <ErrorNote message={diagError} />}
          {diagnostics ? (
            <>
              <div className="stats-grid stats-grid-4">
                <StatCard icon={CheckCircle2} label="الإصدار" value={diagnostics.version} hint={diagnostics.app} />
                <StatCard icon={ShieldCheck} label="البيئة" value={diagnostics.environment} tone="info" />
                <StatCard icon={UsersRound} label="السكان" value={formatNumber(diagnostics.counts.residents || 0)} tone="success" />
                <StatCard icon={AlertTriangle} label="تحذيرات أمنية" value={formatNumber(diagnostics.securityWarnings.length)} tone={diagnostics.securityWarnings.length ? "danger" : "muted"} />
              </div>
              {diagnostics.securityWarnings.length > 0 && (
                <Alert tone="danger">
                  <strong>تحذيرات:</strong> {diagnostics.securityWarnings.join(" · ")}
                </Alert>
              )}
              <div className="dash-grid">
                <section className="form-panel">
                  <div className="panel-title"><div><h2>حالة المخزن</h2><span>وقت الخادم: {formatDateTime(diagnostics.serverTime)}</span></div></div>
                  <InfoGrid
                    items={Object.entries(diagnostics.store || {}).map(([key, value]) => ({
                      label: key,
                      value: typeof value === "boolean" ? (value ? "نعم" : "لا") : typeof value === "object" ? JSON.stringify(value) : String(value),
                    }))}
                  />
                </section>
                <section className="form-panel">
                  <div className="panel-title"><div><h2>أعداد البيانات</h2></div></div>
                  <InfoGrid items={Object.entries(diagnostics.counts || {}).map(([key, value]) => ({ label: key, value: formatNumber(value) }))} />
                </section>
              </div>
              <section className="form-panel">
                <div className="panel-title"><div><h2>خصائص وميزات مفعّلة</h2></div></div>
                <div className="chip-row">
                  {Object.entries(diagnostics.features || {}).map(([key, value]) => (
                    <Badge key={key} tone={value ? "good" : "muted"}>{value ? "✓ " : "✕ "}{key}</Badge>
                  ))}
                  {!Object.keys(diagnostics.features || {}).length && <span className="muted">لا توجد خصائص مخصصة</span>}
                </div>
              </section>
            </>
          ) : (
            <Loader label="جارٍ تحميل التشخيص..." />
          )}
        </>
      )}

      {/* ------------------------------ نموذج المستخدم ---------------------------- */}
      <Modal
        open={userFormOpen}
        title={editingUser ? "تعديل المستخدم" : "مستخدم جديد"}
        subtitle={editingUser ? editingUser.username : "أنشئ حساب دخول وحدد الدور والصلاحيات"}
        onClose={() => setUserFormOpen(false)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setUserFormOpen(false)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveUser} disabled={busy || offline}>
              {busy ? "جارٍ الحفظ..." : "حفظ"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="الاسم الكامل" required>
            <TextInput value={userDraft.name} onChange={(event) => setUserDraft({ ...userDraft, name: event.target.value })} />
          </Field>
          <Field label="اسم المستخدم" required hint="أحرف إنجليزية/أرقام بدون مسافات">
            <TextInput value={userDraft.username} onChange={(event) => setUserDraft({ ...userDraft, username: event.target.value })} dir="ltr" />
          </Field>
          <Field label={editingUser ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور"} required={!editingUser} hint="6 أحرف على الأقل">
            <TextInput type="password" value={userDraft.password} onChange={(event) => setUserDraft({ ...userDraft, password: event.target.value })} dir="ltr" />
          </Field>
          <Field label="الدور" required>
            <Select value={userDraft.roleId} onChange={(event) => setUserDraft({ ...userDraft, roleId: event.target.value })} options={roleOptions} />
          </Field>
          <Field label="الجوال">
            <TextInput value={userDraft.phone} onChange={(event) => setUserDraft({ ...userDraft, phone: event.target.value })} dir="ltr" />
          </Field>
          {userDraft.roleId === "r_contractor" && (
            <Field label="المتعهد المرتبط" required>
              <Select value={userDraft.contractorId} onChange={(event) => setUserDraft({ ...userDraft, contractorId: event.target.value })} options={contractorOptions} placeholder="اختر المتعهد..." />
            </Field>
          )}
          {userDraft.roleId === "r_dept_manager" && (
            <Field label="الإدارة" required hint="يرى مدير الإدارة طلبات متعهدي إدارته فقط">
              <Select value={userDraft.department} onChange={(event) => setUserDraft({ ...userDraft, department: event.target.value })} options={DEPARTMENT_OPTIONS} placeholder="اختر الإدارة..." />
            </Field>
          )}
          <label className="check-item check-row full">
            <input type="checkbox" checked={userDraft.isActive} onChange={(event) => setUserDraft({ ...userDraft, isActive: event.target.checked })} />
            <span><strong>حساب نشط</strong><small>يمكن للمستخدم تسجيل الدخول</small></span>
          </label>
          <label className="check-item check-row full">
            <input type="checkbox" checked={userDraft.mustChangePassword} onChange={(event) => setUserDraft({ ...userDraft, mustChangePassword: event.target.checked })} />
            <span><strong>إلزام تغيير كلمة المرور</strong><small>سيُطلب من المستخدم تعيين كلمة مرور جديدة عند أول دخول</small></span>
          </label>
        </div>
        {userFormError && <Alert tone="danger">{userFormError}</Alert>}
      </Modal>

      {/* ---------------------------- إعادة تعيين كلمة المرور ---------------------- */}
      <Modal
        open={!!resetTarget}
        title="إعادة تعيين كلمة المرور"
        subtitle={resetTarget ? `${resetTarget.name} — ${resetTarget.username}` : undefined}
        onClose={() => setResetTarget(null)}
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setResetTarget(null)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveReset} disabled={busy || offline}>
              <KeyRound size={16} /> إعادة التعيين
            </button>
          </>
        }
      >
        <Field label="كلمة المرور الجديدة" required hint="6 أحرف على الأقل — سيُطلب تغييرها عند الدخول">
          <TextInput type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} dir="ltr" />
        </Field>
        {resetError && <Alert tone="danger">{resetError}</Alert>}
      </Modal>

      {/* -------------------------------- نموذج الدور ---------------------------- */}
      <Modal
        open={roleFormOpen}
        title={editingRole ? "تعديل الدور" : "دور جديد"}
        subtitle="اختر الصلاحيات التي يمنحها هذا الدور"
        onClose={() => setRoleFormOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="secondary-btn" onClick={() => setRoleFormOpen(false)}>إلغاء</button>
            <button type="button" className="primary-btn" onClick={saveRole} disabled={busy || offline}>
              {busy ? "جارٍ الحفظ..." : "حفظ"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="اسم الدور" required>
            <TextInput value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} />
          </Field>
          <Field label="الوصف">
            <TextInput value={roleDraft.description} onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })} />
          </Field>
        </div>
        <Divider label={`الصلاحيات (${roleDraft.permissionIds.length})`} />
        <div className="permission-groups">
          {permissionGroups.map(([prefix, items]) => (
            <div className="permission-group" key={prefix}>
              <div className="permission-group-head">
                <strong>{ROLE_PERMISSION_GROUPS[prefix] || prefix}</strong>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    const allSelected = items.every((item) => roleDraft.permissionIds.includes(item.id));
                    setRoleDraft({
                      ...roleDraft,
                      permissionIds: allSelected
                        ? roleDraft.permissionIds.filter((id) => !items.some((item) => item.id === id))
                        : Array.from(new Set([...roleDraft.permissionIds, ...items.map((item) => item.id)])),
                    });
                  }}
                >
                  {items.every((item) => roleDraft.permissionIds.includes(item.id)) ? "إلغاء الكل" : "تحديد الكل"}
                </button>
              </div>
              <div className="permission-list">
                {items.map((permission) => (
                  <label key={permission.id} className="check-item check-row">
                    <input
                      type="checkbox"
                      checked={roleDraft.permissionIds.includes(permission.id)}
                      onChange={(event) => {
                        setRoleDraft({
                          ...roleDraft,
                          permissionIds: event.target.checked
                            ? [...roleDraft.permissionIds, permission.id]
                            : roleDraft.permissionIds.filter((id) => id !== permission.id),
                        });
                      }}
                    />
                    <span><strong>{permission.label}</strong><small>{permission.id}</small></span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {!permissionGroups.length && <EmptyState title="لا توجد صلاحيات متاحة" />}
        </div>
        {roleFormError && <Alert tone="danger">{roleFormError}</Alert>}
      </Modal>
    </>
  );
}

function SectionIntro({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="section-inline-title">{title}</h2>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}
