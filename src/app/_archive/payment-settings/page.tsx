"use client";

import {
  PageHeader, Panel, Btn, Field, Input, Toggle, Badge, Loading, ErrorBox, useAsync,
} from "@/components/ui";
import { CreditCard, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

type Settings = {
  ecpayEnabled: boolean;
  ecpayMerchant: string;
  opayEnabled: boolean;
  opayMerchant: string;
  paypalEnabled: boolean;
  paypalClientId: string;
  minAmount: number;
  hasEcpayKey: boolean;
  hasOpayKey: boolean;
};

const PROVIDERS = [
  { key: "ecpay", label: "綠界 ECPay", color: "#0bbf50", merchantField: "ecpayMerchant" as const, keyField: "ecpayHashKey" },
  { key: "opay", label: "歐付寶 OPay", color: "#e11d48", merchantField: "opayMerchant" as const, keyField: "opayHashKey" },
  { key: "paypal", label: "PayPal", color: "#0070ba", merchantField: null, keyField: null },
];

export default function PaymentSettingsPage() {
  const [form, setForm] = useState<Partial<Settings> & { ecpayHashKey?: string; opayHashKey?: string }>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const { data, loading, error, reload } = useAsync<{ settings: Settings | null }>(
    () => fetch("/api/v1/payment-settings").then((r) => r.json()),
    []
  );

  const s: Settings = { ...(data?.settings ?? {
    ecpayEnabled: false, ecpayMerchant: "", opayEnabled: false, opayMerchant: "",
    paypalEnabled: false, paypalClientId: "", minAmount: 30, hasEcpayKey: false, hasOpayKey: false,
  }), ...form };

  const set = (k: string, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    setMsg(null);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = { ...s };
      delete payload.hasEcpayKey;
      delete payload.hasOpayKey;
      const res = await fetch("/api/v1/payment-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`儲存失敗 (${res.status})`);
      setForm({});
      await reload();
      setMsg({ tone: "ok", text: "金流設定已儲存" });
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
        title="金流設定"
        description="設定觀眾斗內要走的金流管道。每個管道都需要先在供應商後台開通商店，再把商店代號與雜湊金鑰填回這裡。"
        actions={
          <Badge tone={s.ecpayEnabled || s.opayEnabled || s.paypalEnabled ? "ok" : "neutral"}>
            {s.ecpayEnabled || s.opayEnabled || s.paypalEnabled ? "已有啟用的金流" : "尚未啟用任何金流"}
          </Badge>
        }
      />

      {error && <ErrorBox message={error} />}
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

      <div className="mb-[18px] flex items-start gap-[12px] rounded-[var(--ic-radius-lg)] border border-[var(--ic-brand-accent-border)] bg-[var(--ic-brand-accent-soft)] px-[18px] py-[14px]">
        <ShieldCheck size={19} className="mt-[2px] flex-shrink-0 text-[var(--ic-brand-accent)]" />
        <p className="text-[14px] leading-[1.65] text-[var(--ic-ink-subtle)]">
          雜湊金鑰只寫入、永不回傳到瀏覽器。儲存後介面只會顯示「已設定」，
          想要更換請直接覆蓋輸入欄位後儲存。
        </p>
      </div>

      <div className="mb-[18px] grid gap-[18px] md:grid-cols-3">
        {PROVIDERS.map((p) => {
          const enabled = p.key === "ecpay" ? s.ecpayEnabled : p.key === "opay" ? s.opayEnabled : s.paypalEnabled;
          const toggle = p.key === "ecpay" ? "ecpayEnabled" : p.key === "opay" ? "opayEnabled" : "paypalEnabled";
          const hasKey = p.key === "ecpay" ? s.hasEcpayKey : p.key === "opay" ? s.hasOpayKey : !!s.paypalClientId;
          return (
            <div
              key={p.key}
              className="rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[18px]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-[9px]">
                  <span className="h-[10px] w-[10px] rounded-full" style={{ background: p.color }} />
                  <span className="text-[17px] font-[800] text-[var(--ic-ink)]">{p.label}</span>
                </div>
                <Badge tone={enabled ? "ok" : "neutral"}>{enabled ? "啟用" : "停用"}</Badge>
              </div>
              <div className="mt-[8px] text-[13px] text-[var(--ic-ink-muted)]">
                {hasKey ? (p.key === "paypal" ? "Client ID 已設定" : "金鑰已設定") : "尚未設定金鑰"}
              </div>
              <div className="mt-[14px]">
                <Toggle label="啟用此金流" checked={enabled} onChange={(v) => set(toggle, v)} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-[18px]">
        <Panel title="綠界 ECPay" description="信用卡、ATM、超商、電子錢包全支援，是台灣直播斗內最常用的一家。">
          <div className="flex flex-col gap-[16px]">
            <Toggle label="啟用綠界" checked={s.ecpayEnabled} onChange={(v) => set("ecpayEnabled", v)} />
            <Field label="商店代號 (Merchant ID)" hint="在綠界後台「基本設定」可以找到。">
              <Input value={s.ecpayMerchant} onChange={(e) => set("ecpayMerchant", e.target.value)} placeholder="例如 12345678" />
            </Field>
            <Field
              label={s.hasEcpayKey ? "雜湊金鑰（已設定，留空則不變更）" : "雜湊金鑰 (Hash Key)"}
            >
              <div className="relative">
                <Input
                  type={showKey.ecpay ? "text" : "password"}
                  value={form.ecpayHashKey || ""}
                  onChange={(e) => set("ecpayHashKey", e.target.value)}
                  placeholder={s.hasEcpayKey ? "••••••••" : "輸入綠界提供的 Hash Key"}
                  className="pr-[42px] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((k) => ({ ...k, ecpay: !k.ecpay }))}
                  className="absolute top-1/2 right-[10px] -translate-y-1/2 text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-ink)]"
                >
                  {showKey.ecpay ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          </div>
        </Panel>

        <Panel title="歐付寶 OPay" description="支援街口支付、LINE Pay 與各大錢包，適合習慣用手機支付的觀眾。">
          <div className="flex flex-col gap-[16px]">
            <Toggle label="啟用歐付寶" checked={s.opayEnabled} onChange={(v) => set("opayEnabled", v)} />
            <Field label="商店代號 (Merchant ID)">
              <Input value={s.opayMerchant} onChange={(e) => set("opayMerchant", e.target.value)} placeholder="例如 12345678" />
            </Field>
            <Field label={s.hasOpayKey ? "雜湊金鑰（已設定，留空則不變更）" : "雜湊金鑰 (Hash Key)"}>
              <div className="relative">
                <Input
                  type={showKey.opay ? "text" : "password"}
                  value={form.opayHashKey || ""}
                  onChange={(e) => set("opayHashKey", e.target.value)}
                  placeholder={s.hasOpayKey ? "••••••••" : "輸入歐付寶提供的 Hash Key"}
                  className="pr-[42px] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((k) => ({ ...k, opay: !k.opay }))}
                  className="absolute top-1/2 right-[10px] -translate-y-1/2 text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-ink)]"
                >
                  {showKey.opay ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          </div>
        </Panel>

        <Panel title="PayPal" description="海外觀眾的付款管道。">
          <div className="flex flex-col gap-[16px]">
            <Toggle label="啟用 PayPal" checked={s.paypalEnabled} onChange={(v) => set("paypalEnabled", v)} />
            <Field label="Client ID" hint="PayPal Developer 後台取得。Secret 請透過環境變數設定，不存於資料庫。">
              <Input value={s.paypalClientId} onChange={(e) => set("paypalClientId", e.target.value)} placeholder="AeA1Q..." />
            </Field>
          </div>
        </Panel>

        <Panel title="共用設定">
          <Field label="最低斗內金額" hint="低於此金額的斗內頁按鈕會停用。">
            <Input type="number" min={1} value={s.minAmount} onChange={(e) => set("minAmount", Number(e.target.value))} />
          </Field>
        </Panel>

        <div>
          <Btn onClick={save} disabled={saving}>
            <CreditCard size={16} /> {saving ? "儲存中…" : "儲存金流設定"}
          </Btn>
        </div>
      </div>
    </>
  );
}