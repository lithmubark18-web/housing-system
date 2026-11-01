"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* --------------------------------- الترويسة -------------------------------- */

export function PageHead({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

/* ---------------------------------- البطاقات -------------------------------- */

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "primary" | "success" | "danger" | "warn" | "muted" | "info" | "good" | "bad";
}) {
  const resolved = tone === "good" ? "success" : tone === "bad" ? "danger" : tone === "info" ? "primary" : tone;
  return (
    <div className={`metric metric-${resolved}`}>
      {Icon && <Icon size={20} />}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {hint && <span>{hint}</span>}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`form-panel ${className}`}>
      {(title || actions) && (
        <div className="panel-title" style={{ marginBottom: 14 }}>
          <div>
            <h2>{title}</h2>
            {subtitle && <span>{subtitle}</span>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------------------------------- الشارات ---------------------------------- */

export function Badge({
  children,
  tone = "muted",
  dot = false,
}: {
  children: ReactNode;
  tone?: "good" | "bad" | "warn" | "info" | "muted" | "primary";
  dot?: boolean;
}) {
  return (
    <span className={`status status-${tone === "primary" ? "info" : tone}`}>
      {dot && <i className="badge-dot" />}
      {children}
    </span>
  );
}

export function CountPill({ children }: { children: ReactNode }) {
  return <span className="count-pill">{children}</span>;
}

/* ---------------------------------- الحقول ---------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  required,
  className = "",
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      {label && (
        <span>
          {label}
          {required && <b className="req"> *</b>}
        </span>
      )}
      {children}
      {hint && <small className="field-hint">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ui-input ${props.className || ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`ui-input ui-textarea ${props.className || ""}`} />;
}

export function Select({
  options,
  placeholder,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select {...props} className={`ui-input ui-select ${props.className || ""}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "بحث...",
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onSubmit) onSubmit();
        }}
        placeholder={placeholder}
      />
      {value && (
        <button type="button" className="icon-plain" onClick={() => onChange("")} aria-label="مسح البحث">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------- النوافذ ---------------------------------- */

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">إجراء</div>
            <h2>{title}</h2>
            {subtitle && <p className="muted" style={{ margin: "-8px 0 14px" }}>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------- الحالات ---------------------------------- */

export function EmptyState({ title = "لا توجد بيانات", hint, action }: { title?: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "success" | "danger" | "warning"; children: ReactNode }) {
  return <div className={`alert ${tone}`}>{children}</div>;
}

export function Loader({ label = "جارٍ التحميل..." }: { label?: string }) {
  return (
    <div className="loader-page">
      <div className="loader-box">
        <span className="spinner" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="alert danger inline-alert">
      <AlertTriangle size={16} />
      <span>{message}</span>
    </div>
  );
}

/* --------------------------------- الترقيم ---------------------------------- */

export function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (!total) return null;
  return (
    <div className="pagination">
      <span>
        صفحة {page} من {Math.max(pages, 1)} · {total} سجل
      </span>
      <div>
        <button type="button" className="secondary-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronRight size={16} /> السابق
        </button>
        <button type="button" className="secondary-btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          التالي <ChevronLeft size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- التبويب --------------------------------- */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`admin-tabs ${className}`} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={active === tab.id ? "active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.count === "number" && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- التقدم ---------------------------------- */

export function Progress({ value, tone = "good" }: { value: number; tone?: "good" | "warn" | "bad" }) {
  const clamped = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="progress" title={`${clamped}%`}>
      <span className={`progress-fill ${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function occupancyTone(percent: number): "good" | "warn" | "bad" {
  if (percent >= 95) return "bad";
  if (percent >= 80) return "warn";
  return "good";
}

/* -------------------------------- اختيار متعدد ------------------------------- */

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "اختر...",
  emptyLabel = "لا توجد خيارات",
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const set = useMemo(() => new Set(selected), [selected]);
  const summary = useMemo(() => {
    if (!selected.length) return placeholder;
    const labels = options.filter((option) => set.has(option.value)).map((option) => option.label);
    if (labels.length <= 2) return labels.join("، ");
    return `${labels.slice(0, 2).join("، ")} +${labels.length - 2}`;
  }, [options, selected, set, placeholder]);

  return (
    <div className="multiselect" id={id}>
      <button type="button" className={`multiselect-trigger ${selected.length ? "has-value" : ""}`} onClick={() => setOpen(!open)}>
        <span className="multiselect-summary">{summary}</span>
        <span className="multiselect-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="multiselect-backdrop" onClick={() => setOpen(false)} />
          <div className="multiselect-menu">
            <button
              type="button"
              className="multiselect-all"
              onClick={() => onChange(selected.length === options.length ? [] : options.map((option) => option.value))}
            >
              {selected.length === options.length ? "إلغاء تحديد الكل" : "تحديد الكل"}
            </button>
            {!options.length && <div className="multiselect-empty">{emptyLabel}</div>}
            {options.map((option) => (
              <label key={option.value} className="multiselect-option">
                <input
                  type="checkbox"
                  checked={set.has(option.value)}
                  onChange={(event) => {
                    if (event.target.checked) onChange([...selected, option.value]);
                    else onChange(selected.filter((value) => value !== option.value));
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------- المساعد --------------------------------- */

export function InfoGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="detail-grid">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value ?? "—"}</strong>
        </div>
      ))}
    </div>
  );
}

export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="row-actions">{children}</div>;
}

export function Divider({ label }: { label?: string }) {
  return (
    <div className="divider">
      {label && <span>{label}</span>}
      <i />
    </div>
  );
}
