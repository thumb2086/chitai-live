"use client";

import {
  PageHeader, Panel, Btn, Field, Input, Textarea, SelectRow, Toggle, Badge, useFeature,
} from "@/components/ui";
import { Users2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Room = {
  id: string;
  name: string;
  host: string;
  goal: number;
  current: number;
  members: number;
  accent: string;
  description: string;
};
type Cfg = {
  enabled: boolean;
  publicList: boolean;
  maxRooms: string;
  allowGuestJoin: boolean;
  requireApproval: boolean;
  showLeaderboard: boolean;
  rooms: Room[];
};

const DEFAULTS: Cfg = {
  enabled: true,
  publicList: true,
  maxRooms: "5",
  allowGuestJoin: true,
  requireApproval: false,
  showLeaderboard: true,
  rooms: [
    {
      id: "r1",
      name: "週五讀書會",
      host: "大拇哥",
      goal: 5000,
      current: 3200,
      members: 128,
      accent: "#059669",
      description: "每週五固定讀書會，成員一起衝斗內目標。",
    },
    {
      id: "r2",
      name: "深夜台聚",
      host: "阿花",
      goal: 3000,
      current: 860,
      members: 57,
      accent: "#7c3aed",
      description: "午夜場，連續 6 小時不間斷。",
    },
  ],
};

const uid = () => Math.random().toString(36).slice(2, 9);

export default function SharedDonationRoomsPage() {
  const { value: c, set, save, saving, saved } = useFeature<Cfg>("shared-donation-rooms", DEFAULTS);

  const setRooms = (rooms: Room[]) => set("rooms", rooms);
  const patch = (id: string, p: Partial<Room>) => setRooms(c.rooms.map((r) => (r.id === id ? { ...r, ...p } : r)));


  const addRoom = () =>
    setRooms([
      ...c.rooms,
      { id: uid(), name: `新房間 ${c.rooms.length + 1}`, host: "我", goal: 3000, current: 0, members: 1, accent: "#059669", description: "" },
    ]);

  const maxRooms = Number(c.maxRooms) || 5;

  return (
    <>
      <PageHeader
        title="共用斗內房間"
        description="把斗內進度攤開成一個多人共用的房間：朋友或社群成員可以各自出一份，一起累積到同一個目標。適合讀書會、連續劇challenge、粉絲團共鬥。"
        actions={<Badge tone={c.enabled ? "ok" : "neutral"}>{c.enabled ? "已啟用" : "已停用"}</Badge>}
      />

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-[18px]">
          <Panel title="房間規則">
            <div className="flex flex-col gap-[16px]">
              <Toggle label="啟用房間功能" checked={c.enabled} onChange={(v) => set("enabled", v)} />
              <Toggle
                label="公開房間列表"
                hint="觀眾可以在斗內頁看到所有開放中的房間並加入。"
                checked={c.publicList}
                onChange={(v) => set("publicList", v)}
              />
              <Toggle label="允許訪客加入" checked={c.allowGuestJoin} onChange={(v) => set("allowGuestJoin", v)} />
              <Toggle label="加入需審核" checked={c.requireApproval} onChange={(v) => set("requireApproval", v)} />
              <Toggle label="顯示房內排行榜" checked={c.showLeaderboard} onChange={(v) => set("showLeaderboard", v)} />
              <Field label="最多房間數" hint={`目前 ${c.rooms.length} / ${maxRooms}`}>
                <Input type="number" min={1} max={20} value={c.maxRooms} onChange={(e) => set("maxRooms", e.target.value)} />
              </Field>
            </div>
          </Panel>

          <Panel
            title="房間管理"
            actions={
              <Btn
                variant="secondary"
                className="min-h-[34px] px-[14px] text-[14px]"
                onClick={addRoom}
                disabled={c.rooms.length >= maxRooms}
              >
                <Plus size={15} /> 新增房間
              </Btn>
            }
          >
            <div className="flex flex-col gap-[12px]">
              {c.rooms.map((r) => {
                const pct = Math.min(100, Math.round((r.current / Math.max(1, r.goal)) * 100));
                return (
                  <div key={r.id} className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-2)] p-[12px]">
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <input
                        type="color"
                        value={r.accent}
                        onChange={(e) => patch(r.id, { accent: e.target.value })}
                        className="h-[32px] w-[34px] flex-shrink-0 cursor-pointer rounded-[6px] border border-[var(--ic-hairline)] bg-transparent p-[2px]"
                      />
                      <Input value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} className="min-w-[130px] flex-1 font-[600]" />
                      <Badge tone="neutral">{pct}%</Badge>
                      {/* There is no public route for a shared room -- only the
                          /[username] page and the /overlay/* browser sources
                          exist. The old button copied a hardcoded
                          https://livio.example/... URL, which was someone else's
                          brand and a guaranteed 404. Removed rather than pointed
                          at a target that does not exist. */}
                      <span
                        title="尚無公開的房間連結"
                        className="flex items-center text-[12px] text-[var(--ic-ink-tertiary)]"
                      >
                        無公開連結
                      </span>
                      <button
                        onClick={() => setRooms(c.rooms.filter((x) => x.id !== r.id))}
                        title="刪除房間"
                        className="text-[var(--ic-ink-tertiary)] hover:text-[var(--ic-danger)]"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <div className="mt-[10px] h-[6px] w-full overflow-hidden rounded-full bg-[var(--ic-surface-4)]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: r.accent }} />
                    </div>

                    <div className="mt-[10px] grid grid-cols-2 gap-[8px] sm:grid-cols-4">
                      <Input value={r.host} onChange={(e) => patch(r.id, { host: e.target.value })} placeholder="發起人" className="text-[13px]" />
                      <Input type="number" value={r.goal} onChange={(e) => patch(r.id, { goal: Number(e.target.value) })} className="text-[13px]" title="目標" />
                      <Input type="number" value={r.current} onChange={(e) => patch(r.id, { current: Number(e.target.value) })} className="text-[13px]" title="目前金額" />
                      <Input type="number" value={r.members} onChange={(e) => patch(r.id, { members: Number(e.target.value) })} className="text-[13px]" title="成員數" />
                    </div>
                    <Textarea
                      rows={2}
                      value={r.description}
                      onChange={(e) => patch(r.id, { description: e.target.value })}
                      placeholder="房間說明"
                      className="mt-[8px] text-[13px]"
                    />
                  </div>
                );
              })}
              {c.rooms.length === 0 && (
                <div className="rounded-[var(--ic-radius-md)] border border-dashed border-[var(--ic-hairline-strong)] p-[26px] text-center text-[14px] text-[var(--ic-ink-muted)]">
                  尚未建立任何房間
                </div>
              )}
            </div>
          </Panel>

          <Btn onClick={save} disabled={saving}>
            {saving ? "儲存中…" : saved ? "已儲存" : "儲存設定"}
          </Btn>
        </div>

        <Panel title="房間預覽" description="觀眾在斗內頁看到的樣子。">
          <div className="grid gap-[14px] sm:grid-cols-2">
            {c.rooms.map((r) => {
              const pct = Math.min(100, Math.round((r.current / Math.max(1, r.goal)) * 100));
              return (
                <div
                  key={r.id}
                  className="rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[18px]"
                  style={{ opacity: c.enabled ? 1 : 0.45 }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[17px] font-[800] text-[var(--ic-ink)]">{r.name}</div>
                      <div className="mt-[2px] text-[13px] text-[var(--ic-ink-muted)]">{r.host} 發起</div>
                    </div>
                    <span className="flex-shrink-0 rounded-full px-[10px] py-[3px] text-[12px] font-[700] text-white" style={{ background: r.accent }}>
                      {pct}%
                    </span>
                  </div>

                  <div className="mt-[14px] h-[10px] w-full overflow-hidden rounded-full bg-[var(--ic-surface-4)]">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: r.accent }} />
                  </div>

                  <div className="mt-[8px] flex items-center justify-between text-[13px] text-[var(--ic-ink-muted)]">
                    <span className="tabular-nums">{r.current.toLocaleString()} / {r.goal.toLocaleString()} 元</span>
                    <span className="inline-flex items-center gap-[5px]">
                      <Users2 size={13} /> {r.members} 人
                    </span>
                  </div>

                  {r.description && <p className="mt-[10px] text-[13px] leading-[1.6] text-[var(--ic-ink-subtle)]">{r.description}</p>}

                  {c.showLeaderboard && (
                    <div className="mt-[12px] rounded-[var(--ic-radius-md)] bg-[var(--ic-surface-3)] px-[12px] py-[9px] text-[13px] text-[var(--ic-ink-subtle)]">
                      貢獻排行：<strong className="text-[var(--ic-ink)]">{r.host}</strong> 最突出
                    </div>
                  )}

                  <div className="mt-[12px] flex gap-2">
                    <button
                      disabled={!c.enabled || (c.requireApproval && !c.allowGuestJoin)}
                      className="min-h-[34px] flex-1 rounded-[var(--ic-radius-md)] border border-transparent px-[12px] text-[14px] font-[600] text-white transition-opacity disabled:opacity-40"
                      style={{ background: r.accent }}
                    >
                      {c.requireApproval ? "申請加入" : "加入房間"}
                    </button>
                  </div>
                </div>
              );
            })}
            {c.rooms.length === 0 && (
              <div className="col-span-full rounded-[var(--ic-radius-md)] border border-dashed border-[var(--ic-hairline-strong)] p-[40px] text-center text-[14px] text-[var(--ic-ink-muted)]">
                新增房間後會在這裡預覽
              </div>
            )}
          </div>
          {!c.publicList && (
            <p className="mt-[14px] text-[13px] text-[var(--ic-ink-muted)]">
              房間目前不會出現在公開列表，只有拿到連結的觀眾可以加入。
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}
