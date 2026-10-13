"use client";

import {
  PageHeader, Panel, Btn, Field, Input, Textarea, Badge, EmptyState, Loading, ErrorBox, StatCard, useAsync,
} from "@/components/ui";
import { Plus, Trash2, CalendarDays, Users, Save, MapPin } from "lucide-react";
import { useState } from "react";

type Meetup = {
  id: string; title: string; description: string; location: string;
  startsAt: string; endsAt: string | null; capacity: number; price: number; status: string;
  registrations: { id: string; name: string; createdAt: string }[];
};

const STATUS_LABEL: Record<string, string> = { draft: "草稿", open: "報名中", closed: "已截止", completed: "已結束" };
const STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "brand"> = {
  draft: "neutral", open: "ok", closed: "warn", completed: "brand",
};

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const emptyDraft = {
  id: "", title: "", description: "", location: "",
  startsAt: toLocalInput(new Date(Date.now() + 7 * 864e5).toISOString()),
  endsAt: "", capacity: 50, price: 0, status: "open",
};

export default function MeetupsPage() {
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<{ meetups: Meetup[] }>(
    () => fetch("/api/v1/meetups").then((r) => { if (!r.ok) throw new Error("載入失敗"); return r.json(); }),
    []
  );

  const meetups = data?.meetups ?? [];
  const openCount = meetups.filter((m) => m.status === "open").length;
  const totalRegs = meetups.reduce((a, m) => a + m.registrations.length, 0);

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/v1/meetups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `操作失敗 (${res.status})`);
      }
      await reload();
      setDraft(emptyDraft);
    } catch (e: any) { setErr(e?.message || "操作失敗"); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title="台聚活動"
        description="辦線下場次或線上聚會。觀眾在斗內頁報名，你可以設定名額上限與收費，並隨時查看報名名單。"
        actions={<Badge tone={openCount ? "ok" : "neutral"}>{openCount} 場開放報名</Badge>}
      />

      {error && <ErrorBox message={error} />}
      {err && <ErrorBox message={err} />}

      <div className="mb-[18px] grid gap-[14px] sm:grid-cols-3">
        <StatCard label="場次總數" value={String(meetups.length)} />
        <StatCard label="開放報名" value={String(openCount)} />
        <StatCard label="報名人次" value={String(totalRegs)} />
      </div>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <Panel title="活動列表" actions={<CalendarDays size={16} className="text-[var(--ic-ink-tertiary)]" />}>
          {loading && <Loading />}
          {!loading && meetups.length === 0 && <EmptyState title="還沒有活動" description="使用右側表單建立第一場台聚。" />}

          <div className="flex flex-col gap-[12px]">
            {meetups.map((m) => {
              const pct = m.capacity > 0 ? Math.min(100, Math.round((m.registrations.length / m.capacity) * 100)) : 0;
              const full = m.capacity > 0 && m.registrations.length >= m.capacity;
              const isOpen = openId === m.id;
              return (
                <div key={m.id} className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-2)] p-[14px]">
                  <div className="flex flex-wrap items-start justify-between gap-[10px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-[8px]">
                        <span className="text-[17px] font-[800] text-[var(--ic-ink)]">{m.title}</span>
                        <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                      </div>
                      <div className="mt-[4px] flex flex-wrap items-center gap-[14px] text-[13px] text-[var(--ic-ink-muted)]">
                        <span className="inline-flex items-center gap-[5px]">
                          <CalendarDays size={13} /> {new Date(m.startsAt).toLocaleString("zh-TW")}
                        </span>
                        {m.location && <span className="inline-flex items-center gap-[5px]"><MapPin size={13} />{m.location}</span>}
                        <span className="inline-flex items-center gap-[5px]">
                          <Users size={13} /> {m.registrations.length}{m.capacity > 0 ? ` / ${m.capacity}` : ""} 人
                        </span>
                        {m.price > 0 && <span className="font-[700] text-[var(--ic-brand-accent)]">NT$ {m.price}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={m.status}
                        onChange={(e) => call({ _meta: "setStatus", id: m.id, status: e.target.value })}
                        disabled={busy}
                        className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline-strong)] bg-[var(--ic-surface-1)] px-[9px] py-[6px] text-[13px] outline-none focus:border-[var(--ic-brand-accent)]"
                      >
                        {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <button onClick={() => setDraft({ ...m, startsAt: toLocalInput(m.startsAt), endsAt: m.endsAt ? toLocalInput(m.endsAt) : "" })} className="px-[8px] text-[13px] font-[600] text-[var(--ic-ink-muted)] hover:text-[var(--ic-brand-accent)]">編輯</button>
                      <button onClick={() => call({ _meta: "delete", id: m.id })} disabled={busy} className="text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-danger)]"><Trash2 size={15} /></button>
                    </div>
                  </div>

                  {m.description && <p className="mt-[10px] text-[14px] leading-[1.6] text-[var(--ic-ink-subtle)]">{m.description}</p>}

                  {m.capacity > 0 && (
                    <div className="mt-[12px]">
                      <div className="h-[6px] w-full overflow-hidden rounded-full bg-[var(--ic-surface-4)]">
                        <div className={`h-full rounded-full ${full ? "bg-[var(--ic-danger)]" : "bg-[var(--ic-brand-accent)]"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-[5px] text-[12px] text-[var(--ic-ink-muted)]">{pct}% 名額已滿{full ? " · 已額滿" : ""}</div>
                    </div>
                  )}

                  <button onClick={() => setOpenId(isOpen ? null : m.id)} className="mt-[12px] text-[13px] font-[600] text-[var(--ic-brand-accent)] underline-offset-2 hover:underline">
                    {isOpen ? "收合報名名單" : `查看報名名單 (${m.registrations.length})`}
                  </button>

                  {isOpen && (
                    <div className="mt-[10px] rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[12px]">
                      {m.registrations.length === 0 ? (
                        <div className="text-[13px] text-[var(--ic-ink-muted)]">尚未有人報名。</div>
                      ) : (
                        <div className="flex flex-col gap-[6px]">
                          {m.registrations.map((r) => (
                            <div key={r.id} className="flex items-center justify-between gap-[10px] text-[14px]">
                              <span className="text-[var(--ic-ink)]">{r.name}</span>
                              <span className="flex items-center gap-[10px]">
                                <span className="text-[12px] text-[var(--ic-ink-tertiary)]">{new Date(r.createdAt).toLocaleDateString("zh-TW")}</span>
                                <button onClick={() => call({ _meta: "removeRegistration", id: r.id })} disabled={busy} className="text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-danger)]"><Trash2 size={14} /></button>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-[10px] flex gap-2">
                        <Input
                          placeholder="手動新增報名者"
                          className="text-[13px]"
                          onKeyDown={(e) => {
                            const v = e.currentTarget.value.trim();
                            if (e.key === "Enter" && v) { call({ _meta: "addRegistration", meetupId: m.id, name: v }); e.currentTarget.value = ""; }
                          }}
                        />
                        <Btn
                          variant="secondary"
                          className="min-h-[38px] px-[14px]"
                          disabled={busy || full}
                          onClick={(e) => {
                            const input = (e.currentTarget.previousSibling as HTMLInputElement);
                            const v = input?.value.trim();
                            if (v) { call({ _meta: "addRegistration", meetupId: m.id, name: v }); input.value = ""; }
                          }}
                        >
                          <Plus size={15} /> 新增
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title={draft.id ? "編輯活動" : "新增活動"}>
          <div className="flex flex-col gap-[14px]">
            <Field label="活動名稱">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="例如：12 月冬季台聚" />
            </Field>
            <Field label="說明">
              <Textarea rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <Field label="地點 / 頻道">
              <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="台北信義威秀 / Discord 語音" />
            </Field>
            <Field label="開始時間">
              <Input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
            </Field>
            <Field label="結束時間" hint="留空代表未定。">
              <Input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-[12px]">
              <Field label="名額上限" hint="0 代表不限。">
                <Input type="number" min={0} value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })} />
              </Field>
              <Field label="費用 (TWD)">
                <Input type="number" min={0} value={draft.price} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="狀態">
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                className="w-full rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline-strong)] bg-[var(--ic-surface-1)] px-[12px] py-[10px] text-[15px] text-[var(--ic-ink)] outline-none focus:border-[var(--ic-brand-accent)]"
              >
                {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <div className="flex gap-2">
              <Btn
                className="flex-1"
                disabled={busy || !draft.title.trim()}
                onClick={() =>
                  call({
                    _meta: draft.id ? "update" : "add",
                    ...draft,
                    startsAt: new Date(draft.startsAt).toISOString(),
                    endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
                  })
                }
              >
                <Save size={15} /> {draft.id ? "儲存變更" : "建立活動"}
              </Btn>
              {draft.id && <Btn variant="ghost" onClick={() => setDraft(emptyDraft)}>取消</Btn>}
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}