"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Page scaffolding                                                    */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="creator-profile-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="subtitle">{description}</p>}
      </div>
      {actions && <div className="hero-actions">{actions}</div>}
    </header>
  );
}

export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="breadcrumb" aria-label="麵包屑">
      {items.map((it, i) =>
        it.href ? (
          <Link key={i} href={it.href} data-link="" prefetch={false}>
            {it.label}
          </Link>
        ) : (
          <span key={i} aria-current="page">
            {it.label}
          </span>
        )
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  description,
  actions,
  children,
  highlight = false,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel${highlight ? " panel-highlight" : ""}${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <div className="section-title-row">
          {title && <h2 className="profile-card-title">{title}</h2>}
          {actions && <div className="action-row">{actions}</div>}
        </div>
      )}
      {description && <p className="settings-note">{description}</p>}
      {children}
    </section>
  );
}

/** Vertical rhythm container — the console's standard inner wrapper. */
export function Stack({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`stack${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function SectionBlock({ children }: { children: ReactNode }) {
  return <div className="stack form-section-block">{children}</div>;
}

export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="action-row">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Btn({ variant = "primary", className = "", ...props }: BtnProps) {
  const cls =
    variant === "primary"
      ? "primary-button"
      : variant === "secondary"
        ? "secondary-button"
        : variant === "danger"
          ? "danger-button"
          : "ghost-button";
  return <button {...props} className={`${cls}${className ? ` ${className}` : ""}`} />;
}

export function GhostLink({
  href,
  children,
  className = "",
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} data-link="" className={`ghost-link${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field${className ? ` ${className}` : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={className} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return <select {...rest} className={className} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea {...rest} className={className} />;
}

/** Checkbox pill switch — the console's standard toggle. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="creator-toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SelectRow({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Status + data display                                               */
/* ------------------------------------------------------------------ */

export type Tone = "neutral" | "ok" | "warn" | "danger" | "live" | "brand" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "",
  ok: "status-ok",
  warn: "",
  danger: "status-error",
  live: "status-live",
  brand: "is-accent",
  accent: "is-accent",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const extra = TONE_CLASS[tone];
  return <span className={`status-pill${extra ? ` ${extra}` : ""}`}>{children}</span>;
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel">
      <div className="mini-label">{label}</div>
      <div className="mini-value">{value}</div>
      {sub && <div className="settings-note">{sub}</div>}
    </div>
  );
}

export function StatGrid({ children, cols = 3 }: { children: ReactNode; cols?: number }) {
  return (
    <div
      className="feature-grid-mini"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      {description && <span>{description}</span>}
    </div>
  );
}

export function Loading({ label = "載入中…" }: { label?: string }) {
  return (
    <div className="output-empty">
      <p>{label}</p>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="security-warning" role="alert">
      {message}
    </div>
  );
}

export function CodeBlock({ value }: { value: string }) {
  return (
    <div className="code-block">
      <pre>{value}</pre>
    </div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className="list">{children}</div>;
}

export function ListRow({
  title,
  subtitle,
  meta,
  actions,
  onClick,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className={`list-row${onClick ? " clickable" : ""}`} onClick={onClick}>
      <div className="stack">
        <div className="row-title">{title}</div>
        {subtitle && <div className="row-subtitle">{subtitle}</div>}
      </div>
      {meta && <div className="row-meta">{meta}</div>}
      {actions && <div className="action-row">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data fetching                                                       */
/* ------------------------------------------------------------------ */

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e?.message || "載入失敗"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}

/**
 * Load/save a per-feature JSON settings blob backed by FeatureSettings.
 */
export function useFeature<T extends Record<string, unknown>>(featureKey: string, defaults: T) {
  const [value, setValue] = useState<T>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`https://api.zixilive.dpdns.org/api/v1/features/${featureKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setValue({ ...defaults, ...(d?.settings ?? {}) });
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureKey]);

  const set = <K extends keyof T>(k: K, v: T[K]) => {
    setValue((prev) => ({ ...prev, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`https://api.zixilive.dpdns.org/api/v1/features/${featureKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: value }),
      });
      if (!res.ok) throw new Error(`儲存失敗 (${res.status})`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e: any) {
      setError(e?.message || "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  return { value, setValue, set, save, loading, saving, saved, error };
}