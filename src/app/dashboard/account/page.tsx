"use client";

import {
  PageHeader, Panel, Btn, Field, Input, Toggle, Badge, Loading, ErrorBox,
} from "@/components/ui";
import { UserCog, LogOut, ShieldCheck, Save } from "lucide-react";
import { useEffect, useState } from "react";

type User = {
  id: string; name: string; username: string; email: string; avatar: string;
  demoMode: boolean; publicPage: boolean; createdAt: string;
};

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState<Partial<User>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const authHeaders = (): Record<string, string> => {
    try {
      const t = localStorage.getItem("chitai_token") || (document.cookie.match(/token=([^;]+)/)?.[1] ?? "");
      return t ? { Authorization: `Bearer ${t}` } : {};
    } catch { return {}; }
  };

  const load = async () => {
    try {
      const r = await fetch("https://api.zixilive.dpdns.org/api/v1/user", { headers: authHeaders() });
      if (!r.ok) throw new Error("無法載入帳戶資料");
      const j = await r.json();
      const u = j?.data ?? j;
      setUser({ ...u, id: String(u?.id ?? ""), createdAt: u?.created_at ?? u?.createdAt ?? "" });
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message || "載入失敗" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const v = { ...(user ?? {}), ...form } as User;
  const set = (k: string, val: unknown) => { setForm((f) => ({ ...f, [k]: val })); setMsg(null); };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("https://api.zixilive.dpdns.org/api/v1/user", {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: v.name, username: v.username, avatar: v.avatar, demoMode: v.demoMode, publicPage: v.publicPage }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `儲存失敗 (${res.status})`);
      const saved = j?.data ?? j;
      setForm({});
      setUser({ ...saved, id: String(saved?.id ?? user?.id ?? ""), createdAt: saved?.created_at ?? saved?.createdAt ?? user?.createdAt ?? "" });
      setMsg({ tone: "ok", text: "帳戶設定已更新" });
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message || "儲存失敗" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader
        title="帳戶設定"
        description="管理你的顯示名稱、公開頁面網址與頭像。電子郵件與方案由 OAuth 身分綁定，無法在此修改。"
        actions={<Badge tone="neutral">{v.username ? `@${v.username}` : "未設定使用者名稱"}</Badge>}
      />

      {msg && (
        <div
          className={`mb-[18px] rounded-[var(--ic-radius-md)] border px-[14px] py-[11px] text-[14px] ${
            msg.tone === "ok"
              ? "border-[var(--ic-success-border)] bg-[var(--ic-success-soft)] text-[var(--ic-success-ink)]"
              : "border-[rgba(220,38,38,.28)] bg-[var(--ic-danger-soft)] text-[var(--ic-danger)]"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="flex flex-col gap-[18px]">
          <Panel title="個人資料">
            <div className="flex flex-col gap-[18px]">
              <div className="flex items-center gap-[16px]">
                {v.avatar ? (
                  <img src={v.avatar} alt="" className="h-[64px] w-[64px] rounded-full object-cover" />
                ) : (
                  <span className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[var(--ic-brand-accent)] text-[24px] font-[800] text-white">
                    {v.name?.charAt(0) || "?"}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <Field label="頭像網址">
                    <Input value={v.avatar ?? ""} onChange={(e) => set("avatar", e.target.value)} placeholder="https://…" />
                  </Field>
                </div>
              </div>

              <div className="grid gap-[16px] sm:grid-cols-2">
                <Field label="顯示名稱" hint="會顯示在公開斗內頁與疊加層。">
                  <Input value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} />
                </Field>
                <Field label="使用者名稱" hint="公開頁網址為 /@<使用者名稱>，建立後更改次數有限。">
                  <div className="flex items-center">
                    <span className="flex h-full items-center rounded-l-[var(--ic-radius-md)] border border-r-0 border-[var(--ic-hairline-strong)] bg-[var(--ic-surface-3)] px-[12px] text-[15px] text-[var(--ic-ink-muted)]">
                      @
                    </span>
                    <Input
                      value={v.username ?? ""}
                      onChange={(e) => set("username", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      className="rounded-l-none"
                    />
                  </div>
                </Field>
              </div>

              <div>
                <Btn onClick={save} disabled={saving}>
                  <Save size={15} /> {saving ? "儲存中…" : "儲存變更"}
                </Btn>
              </div>
            </div>
          </Panel>

          <Panel title="偏好設定">
            <div className="flex flex-col gap-[2px]">
              <Toggle
                label="公開斗內頁"
                hint="關閉後 /@<使用者名稱> 會顯示為未開放。"
                checked={v.publicPage}
                onChange={(val) => set("publicPage", val)}
              />
              <Toggle
                label="模擬訊息模式"
                hint="在聊天室與通知疊加層產生測試訊息，方便直播前檢查畫面。"
                checked={v.demoMode}
                onChange={(val) => set("demoMode", val)}
              />
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-[18px]">
          <Panel title="身分">
            <div className="flex items-start gap-[12px]">
              <ShieldCheck size={18} className="mt-[2px] flex-shrink-0 text-[var(--ic-ink-tertiary)]" />
              <div className="min-w-0">
                <div className="text-[13px] text-[var(--ic-ink-muted)]">登入電子郵件</div>
                <div className="mt-[2px] break-all text-[15px] font-[600] text-[var(--ic-ink)]">
                  {v.email || "未綁定"}
                </div>
                <p className="mt-[8px] text-[12px] leading-[1.6] text-[var(--ic-ink-tertiary)]">
                  電子郵件由 Twitch / Google 授權帶入，出於帳號安全不提供自助修改。
                </p>
              </div>
            </div>
            <div className="mt-[16px] border-t border-[var(--ic-hairline)] pt-[14px]">
              <div className="text-[13px] text-[var(--ic-ink-muted)]">帳戶建立於</div>
              <div className="mt-[2px] text-[15px] font-[600] text-[var(--ic-ink)]">
                {user?.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-TW") : "—"}
              </div>
            </div>
          </Panel>

          <Panel title="工作階段">
            <p className="text-[14px] leading-[1.65] text-[var(--ic-ink-subtle)]">
              登出會清除本機的登入 cookie，其他裝置的登入狀態不受影響。
            </p>
            <Btn
              variant="secondary"
              className="mt-[14px] w-full"
              onClick={async () => {
                await fetch("https://api.zixilive.dpdns.org/api/auth/logout", { method: "POST" });
                window.location.href = "/";
              }}
            >
              <LogOut size={15} /> 登出
            </Btn>
          </Panel>

          <div className="flex items-center gap-2 px-[4px] text-[12px] text-[var(--ic-ink-tertiary)]">
            <UserCog size={14} /> 帳戶 ID：{user?.id}
          </div>
        </div>
      </div>
    </>
  );
}