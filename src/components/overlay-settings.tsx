"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Btn } from "./ui";
import { Copy, Check, ExternalLink } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Token plumbing                                                      */
/* ------------------------------------------------------------------ */

export type OverlaySource = {
  key: string;
  name: string;
  path: string;
  hasRoute: boolean;
  id: string;
  token: string;
  enabled: boolean;
  url: string;
};

export type OverlayTokenState = {
  source: OverlaySource | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/** Fetch (and lazily create) the Browser Source token for one overlay. */
export function useOverlayToken(overlayKey: string): OverlayTokenState {
  const [source, setSource] = useState<OverlaySource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("https://api.zixilive.dpdns.org/api/v1/obs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _meta: "ensure", key: overlayKey }),
      });
      if (!res.ok) throw new Error(`無法取得輸出網址 (${res.status})`);
      const data = await res.json();
      setSource(data.source ?? null);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "無法取得輸出網址");
    } finally {
      setLoading(false);
    }
  }, [overlayKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { source, loading, error, reload: load };
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/**
 * livio ships one CSS class family per settings page, all following the same
 * shape (`<family>-page`, `<family>-header`, `<family>-workspace`, ...). Rather
 * than duplicate this component per family, `family` swaps the emitted names so
 * each page matches the stylesheet that actually targets it.
 *
 * Defaults to the overlay family, so existing callers are unaffected.
 */
export function OverlaySettingsPage({
  icon,
  title,
  description,
  summary,
  children,
  className = "",
  family = "overlay-settings",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  summary?: { label: string; value: ReactNode }[];
  children: ReactNode;
  className?: string;
  family?: string;
}) {
  return (
    <section className={`${family}-page${className ? ` ${className}` : ""}`}>
      <header className={`${family}-header`}>
        <span className={`${family}-icon`} aria-hidden="true">
          {icon}
        </span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>

      {summary && summary.length > 0 && (
        <div className={`${family}-summary`} aria-label={`${title}狀態`}>
          {summary.map((s) => (
            <div key={s.label}>
              <span>{s.label}</span>
              <strong>{s.value}</strong>
            </div>
          ))}
        </div>
      )}

      <div className={`${family}-workspace`}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Preview + output columns                                            */
/* ------------------------------------------------------------------ */

export function OverlayPreview({
  title,
  children,
  family = "overlay-settings",
}: {
  title: string;
  children: ReactNode;
  family?: string;
}) {
  return (
    <section className={`${family}-preview`}>
      <h2>{title}</h2>
      <div className={`${family}-preview-body`}>{children}</div>
    </section>
  );
}

export function OverlayOutput({ title = "OBS / Streamlabs 輸出" }: { title?: string }) {
  const { source, loading, error, reload } = useOverlayTokenFromContext();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const reissue = async () => {
    if (!source) return;
    await fetch("https://api.zixilive.dpdns.org/api/v1/obs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _meta: "reissue", id: source.id }),
    });
    await reload();
  };

  if (loading) {
    return (
      <section className="overlay-settings-output">
        <h3>{title}</h3>
        <div className="output-shell">
          <p className="empty-state">正在取得輸出網址…</p>
        </div>
      </section>
    );
  }

  if (error || !source) {
    return (
      <section className="overlay-settings-output">
        <h3>{title}</h3>
        <div className="output-shell output-empty">
          <p className="empty-state">{error ?? "無法建立輸出網址。"}</p>
          <div className="action-row compact-row">
            <Btn className="overlay-output-action is-create" onClick={reload}>
              重試
            </Btn>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overlay-settings-output">
      <h3>{title}</h3>
      <div className="output-shell">
        <div className="output-label">Browser Source 網址</div>
        <div className="output-title">{source.url}</div>
        {!source.hasRoute && (
          <p className="settings-note">
            這個疊加層的輸出頁還沒實作，先建立網址可以保留設定，但貼到 OBS 暫時不會有畫面。
          </p>
        )}
        <div className="action-row compact-row overlay-output-actions">
          <Btn
            variant="secondary"
            className="overlay-output-action"
            onClick={copy}
            disabled={!source.hasRoute}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "已複製" : "複製網址"}
          </Btn>
          <a
            className="ghost-link overlay-output-action"
            href={source.url}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!source.hasRoute}
          >
            <ExternalLink size={15} /> 開啟預覽
          </a>
          <button
            type="button"
            className="ghost-button overlay-output-action"
            onClick={reissue}
          >
            重新產生網址
          </button>
        </div>
        <p className="settings-note">重新產生後舊的 Browser Source 網址會立即失效。</p>
      </div>
    </section>
  );
}

/** Lets a page fetch the token once and hand it to both the summary and output. */
const TokenCtx = createContext<OverlayTokenState | null>(null);

export function OverlayTokenProvider({
  overlayKey,
  children,
}: {
  overlayKey: string;
  children: ReactNode;
}) {
  const value = useOverlayToken(overlayKey);
  return <TokenCtx.Provider value={value}>{children}</TokenCtx.Provider>;
}

/**
 * Reads the token supplied by OverlayTokenProvider. When no provider is present
 * it falls back to fetching the `chat` overlay so the component still renders.
 */
function useOverlayTokenFromContext(): OverlayTokenState {
  const ctx = useContext(TokenCtx);
  const fallback = useOverlayToken("chat");
  return ctx ?? fallback;
}

/* ------------------------------------------------------------------ */
/* Editor column                                                       */
/* ------------------------------------------------------------------ */

export function OverlayEditor({
  title,
  hint,
  children,
  family = "overlay-settings",
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  family?: string;
}) {
  return (
    <section className={`${family}-editor`}>
      <header className={`${family}-editor-header`}>
        <h2>{title}</h2>
        {hint && <span>{hint}</span>}
      </header>
      {children}
    </section>
  );
}

export function SettingsTabs({
  tabs,
  active,
  onChange,
  label,
  family = "overlay-settings",
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (k: string) => void;
  label: string;
  family?: string;
}) {
  return (
    <div className={`${family}-tabs`} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`settings-tab-${t.key}`}
          aria-controls={`settings-panel-${t.key}`}
          aria-selected={active === t.key}
          tabIndex={active === t.key ? 0 : -1}
          className={`${family}-tab${active === t.key ? " is-active" : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsTabPanel({
  tabKey,
  active,
  children,
  family = "overlay-settings",
}: {
  tabKey: string;
  active: string;
  children: ReactNode;
  family?: string;
}) {
  if (tabKey !== active) return null;
  return (
    <div
      className={`${family}-tab-panel`}
      id={`settings-panel-${tabKey}`}
      role="tabpanel"
      aria-labelledby={`settings-tab-${tabKey}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

export function SettingsCard({
  title,
  actions,
  children,
  hidden,
  className = "",
  family = "overlay-settings",
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  hidden?: boolean;
  className?: string;
  family?: string;
}) {
  return (
    <section className={`${family}-card${className ? ` ${className}` : ""}`} hidden={hidden}>
      {title && <h3>{title}</h3>}
      {actions && <div className="source-status-head">{actions}</div>}
      {children}
    </section>
  );
}