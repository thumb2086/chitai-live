"use client";

import { useState } from "react";
import { Btn, Toggle, useFeature } from "@/components/ui";
import {
  OverlaySettingsPage, OverlayPreview, OverlayOutput, OverlayEditor,
  SettingsTabs, SettingsTabPanel, SettingsCard, OverlayTokenProvider,
} from "@/components/overlay-settings";

type Rank = { tier: string; accent: string; text: string; bg: string; border: string; opacity: number };
type Participant = { id: string; name: string; score: number };
type Sheet = { spreadsheetUrl: string; sheetName: string; namesRange: string; scoresRange: string };
type Cfg = {
  enabled: boolean;
  sourceType: "manual" | "google-sheets";
  placement: "top" | "left" | "right";
  fontFamily: "noto" | "jhenghei" | "ui" | "jfopen";
  participants: Participant[];
  ranks: Rank[];
  sheet: Sheet;
  autoSyncSeconds: string;
};

const uid = () => Math.random().toString(36).slice(2, 9);

const rankDefaults = (): Rank[] => [
  { tier: "gold", accent: "#ffb24a", text: "#ffffff", bg: "#10131a", border: "#ffb24a", opacity: 82 },
  { tier: "silver", accent: "#60a5fa", text: "#ffffff", bg: "#10131a", border: "#60a5fa", opacity: 82 },
  { tier: "bronze", accent: "#b45309", text: "#ffffff", bg: "#10131a", border: "#b45309", opacity: 82 },
  { tier: "iron", accent: "#64748b", text: "#ffffff", bg: "#10131a", border: "#64748b", opacity: 82 },
];

const FONTS: Record<string, string> = {
  noto: '"Noto Sans TC","Microsoft JhengHei",sans-serif',
  jhenghei: '"Microsoft JhengHei","Noto Sans TC",sans-serif',
  ui: 'system-ui,-apple-system,"Segoe UI",sans-serif',
  jfopen: '"jf open 粉圓","Noto Sans TC",sans-serif',
};

const DEFAULTS: Cfg = {
  enabled: true,
  sourceType: "manual",
  placement: "top",
  fontFamily: "noto",
  participants: [
    { id: "participant-1", name: "參與者 1", score: 0 },
    { id: "participant-2", name: "參與者 2", score: 0 },
  ],
  ranks: rankDefaults(),
  sheet: { spreadsheetUrl: "", sheetName: "工作表1", namesRange: "E71:G71", scoresRange: "E72:G72" },
  autoSyncSeconds: "5",
};

const TABS = [
  { key: "data", label: "資料" },
  { key: "style", label: "樣式" },
  { key: "sync", label: "同步" },
];

export default function ScoreboardPage() {
  return (
    <OverlayTokenProvider overlayKey="scoreboard">
      <ScoreboardInner />
    </OverlayTokenProvider>
  );
}

function ScoreboardInner() {
  const { value: c, set, save, saving, saved } = useFeature<Cfg>("scoreboard", DEFAULTS);
  const [tab, setTab] = useState("data");

  const ranked = [...c.participants].sort((a, b) => b.score - a.score);
  const rankOf = (id: string) => ranked.findIndex((p) => p.id === id);

  const patchRank = (i: number, p: Partial<Rank>) => {
    const next = c.ranks.map((r, idx) => (idx === i ? { ...r, ...p } : r));
    set("ranks", next);
  };

  const addParticipant = () =>
    set("participants", [
      ...c.participants,
      { id: `participant-${uid()}`, name: `參與者 ${c.participants.length + 1}`, score: 0 },
    ]);

  const removeParticipant = (id: string) =>
    set("participants", c.participants.filter((p) => p.id !== id));

  const rankedVisible = ranked.slice(0, Math.max(2, Math.min(8, c.participants.length)));

  return (
    <OverlaySettingsPage
      className="scoreboard-settings-page"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M12 5v14M7 9h1v6M15 9h2v3h-2v3h2" />
        </svg>
      }
      title="即時比分板"
      description="管理參與者與分數，搭配手動輸入或 Google Sheet，即時呈現比賽進度。"
      summary={[
        { label: "模組狀態", value: <span className={c.enabled ? "is-enabled" : ""}>{c.enabled ? "已啟用" : "已停用"}</span> },
        { label: "資料來源", value: c.sourceType === "manual" ? "手動輸入" : "Google Sheet" },
        { label: "參與者", value: `${c.participants.length} 位` },
      ]}
    >
      <OverlayPreview title="預覽效果">
        <div
          className={`scoreboard-preview-stack placement-${c.placement} density-comfortable`}
          style={
            {
              "--scoreboard-preview-accent": c.ranks[0]?.accent ?? "#ffb24a",
              "--scoreboard-preview-font": FONTS[c.fontFamily] ?? FONTS.noto,
            } as React.CSSProperties
          }
        >
          <div className="scoreboard-preview-grid" role="list">
            {rankedVisible.map((p, i) => {
              const r = c.ranks[rankOf(p.id)] ?? c.ranks[c.ranks.length - 1];
              return (
                <article
                  key={p.id}
                  className={`scoreboard-preview-card rank-tier-${r?.tier ?? "iron"}`}
                  style={
                    {
                      "--scoreboard-preview-tier": r?.accent ?? "#64748b",
                      "--scoreboard-preview-text": r?.text ?? "#ffffff",
                      "--scoreboard-preview-surface": `rgb(16 19 26 / ${(r?.opacity ?? 82) / 100})`,
                      "--scoreboard-preview-border": r?.border ?? "#64748b",
                    } as React.CSSProperties
                  }
                >
                  <div className="scoreboard-preview-rank" aria-label={`第 ${i + 1} 名`}>
                    <small>RANK</small>
                    <strong>{String(i + 1).padStart(2, "0")}</strong>
                  </div>
                  <div className="scoreboard-preview-player">
                    <span>{i === 0 ? "目前領先" : "參與者"}</span>
                    <strong>{p.name}</strong>
                  </div>
                  <div className="scoreboard-preview-value">
                    <span>PTS</span>
                    <strong>{p.score}</strong>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </OverlayPreview>

      <OverlayOutput />

      <OverlayEditor title="比分板設定" hint="儲存後同步">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <SettingsTabs tabs={TABS} active={tab} onChange={setTab} label="比分板設定分類" />

          <SettingsTabPanel tabKey="data" active={tab}>
            <SettingsCard title="資料來源">
              <Toggle
                label="啟用即時比分板"
                hint="在直播畫面中顯示參與者與分數。"
                checked={c.enabled}
                onChange={(v) => set("enabled", v)}
              />
              <div className="form-grid">
                <label>
                  資料來源
                  <select
                    value={c.sourceType}
                    onChange={(e) => set("sourceType", e.target.value as Cfg["sourceType"])}
                  >
                    <option value="manual">手動輸入</option>
                    <option value="google-sheets">公開 Google Sheet</option>
                  </select>
                </label>
              </div>
            </SettingsCard>

            <SettingsCard className="scoreboard-manual-section" hidden={c.sourceType !== "manual"}>
              <div className="source-status-head">
                <div className="source-status-copy">
                  <h3>參與者與分數</h3>
                  <p className="settings-note">建議 2–12 位。按下儲存後，已連線的 OBS 會立即更新。</p>
                </div>
                <button type="button" className="ghost-button" onClick={addParticipant} disabled={c.participants.length >= 12}>
                  新增參與者
                </button>
              </div>

              <div className="stack scoreboard-editor-list">
                {c.participants.map((p) => (
                  <div key={p.id} className="scoreboard-editor-row">
                    <label className="field">
                      <span>參與者名稱</span>
                      <input
                        maxLength={80}
                        value={p.name}
                        onChange={(e) =>
                          set("participants", c.participants.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>目前分數</span>
                      <input
                        type="number"
                        step="any"
                        value={p.score}
                        onChange={(e) =>
                          set(
                            "participants",
                            c.participants.map((x) => (x.id === p.id ? { ...x, score: Number(e.target.value) } : x))
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost-button scoreboard-remove-button"
                      aria-label={`移除 ${p.name}`}
                      onClick={() => removeParticipant(p.id)}
                      disabled={c.participants.length <= 2}
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            </SettingsCard>

            <SettingsCard className="scoreboard-sheet-section" hidden={c.sourceType !== "google-sheets"}>
              <div>
                <h3>Google Sheet 讀取位置</h3>
                <p className="settings-note">
                  試算表必須設為「知道連結的任何人都可檢視」。這裡填的是底部工作表分頁名稱，不是整份試算表標題。
                </p>
              </div>
              <label>
                Google Sheet 網址
                <input
                  type="url"
                  maxLength={500}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  value={c.sheet.spreadsheetUrl}
                  onChange={(e) => set("sheet", { ...c.sheet, spreadsheetUrl: e.target.value })}
                />
              </label>
              <div className="form-grid">
                <label>
                  工作表分頁名稱
                  <input
                    maxLength={100}
                    placeholder="工作表1"
                    value={c.sheet.sheetName}
                    onChange={(e) => set("sheet", { ...c.sheet, sheetName: e.target.value })}
                  />
                </label>
                <label>
                  名稱範圍（A1）
                  <input
                    maxLength={40}
                    placeholder="E71:G71"
                    value={c.sheet.namesRange}
                    onChange={(e) => set("sheet", { ...c.sheet, namesRange: e.target.value })}
                  />
                </label>
                <label>
                  分數範圍（A1）
                  <input
                    maxLength={40}
                    placeholder="E72:G72"
                    value={c.sheet.scoresRange}
                    onChange={(e) => set("sheet", { ...c.sheet, scoresRange: e.target.value })}
                  />
                </label>
              </div>
              <details className="scoreboard-formula-guide">
                <summary>只要記住：公式寫在 Google Sheet</summary>
                <p>
                  名稱放在 <code>E71:G71</code>，分數放在 <code>E72:G72</code>；請在 E72、F72、G72
                  各自填入公式。系統只會讀取最後算出的數字。
                </p>
                <p>名稱和分數的方向、格數要一樣，也不要合併儲存格。若結果不是數字或出現 #N/A，就不會顯示。</p>
              </details>
              <div className="scoreboard-sheet-actions">
                <span className="settings-note">儲存前請先測試，確認名稱與分數對應正確。</span>
              </div>
            </SettingsCard>
          </SettingsTabPanel>

          <SettingsTabPanel tabKey="style" active={tab}>
            <SettingsCard title="版面與文字">
              <div className="form-grid">
                <label>
                  畫面位置
                  <select value={c.placement} onChange={(e) => set("placement", e.target.value as Cfg["placement"])}>
                    <option value="top">上方橫向</option>
                    <option value="left">左側直排</option>
                    <option value="right">右側直排</option>
                  </select>
                </label>
                <label>
                  字體
                  <select value={c.fontFamily} onChange={(e) => set("fontFamily", e.target.value as Cfg["fontFamily"])}>
                    <option value="noto">Noto Sans TC</option>
                    <option value="jhenghei">微軟正黑體</option>
                    <option value="ui">系統介面字體</option>
                    <option value="jfopen">jf open 粉圓</option>
                  </select>
                </label>
              </div>
            </SettingsCard>

            <SettingsCard title="各名次顏色">
              <p className="settings-note">
                每個名次都能獨立設定。排名變動時，顏色會跟著第 1、2、3…名，不會綁定參與者。
              </p>
              <div className="scoreboard-rank-style-list">
                {c.ranks.map((r, i) => (
                  <article key={i} className="scoreboard-rank-style-card">
                    <div className="scoreboard-rank-style-heading">
                      <span className="scoreboard-rank-style-badge" style={{ ["--rank-style-accent" as string]: r.accent }}>
                        {i + 1}
                      </span>
                      <div>
                        <strong>第 {i + 1} 名</strong>
                        <p>這組顏色只套用在第 {i + 1} 名。</p>
                      </div>
                    </div>
                    <div className="scoreboard-rank-color-grid">
                      <label className="field scoreboard-color-field">
                        <span>名次色</span>
                        <input type="color" value={r.accent} onChange={(e) => patchRank(i, { accent: e.target.value })} />
                      </label>
                      <label className="field scoreboard-color-field">
                        <span>文字色</span>
                        <input type="color" value={r.text} onChange={(e) => patchRank(i, { text: e.target.value })} />
                      </label>
                      <label className="field scoreboard-color-field">
                        <span>底色</span>
                        <input type="color" value={r.bg} onChange={(e) => patchRank(i, { bg: e.target.value })} />
                      </label>
                      <label className="field scoreboard-color-field">
                        <span>外框色</span>
                        <input type="color" value={r.border} onChange={(e) => patchRank(i, { border: e.target.value })} />
                      </label>
                      <label className="field scoreboard-rank-opacity-field">
                        <span>底色透明度</span>
                        <span className="scoreboard-opacity-control">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={r.opacity}
                            onChange={(e) => patchRank(i, { opacity: Number(e.target.value) })}
                          />
                          <output>{r.opacity}%</output>
                        </span>
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </SettingsCard>
            <p className="settings-note">調整位置、字體與各名次顏色，即可在左側查看效果。儲存後會同步至直播畫面。</p>
          </SettingsTabPanel>

          <SettingsTabPanel tabKey="sync" active={tab}>
            <SettingsCard>
              <div className="source-status-head">
                <h3>同步狀態</h3>
                <span className="status-pill status-draft">尚未同步</span>
              </div>
              <p className="settings-note">最近成功更新：尚未收到</p>
            </SettingsCard>
            <SettingsCard title="更新方式">
              <p className="settings-note">
                手動輸入：按下「儲存並同步比分板」，已連線的 OBS 會立即更新。
              </p>
              <p className="settings-note">
                Google Sheet 模式啟用後會每 {c.autoSyncSeconds} 秒同步一次，不需要保持 OBS 連線。回應較慢時會保留上次成功分數，系統會逐步延長重試間隔。
              </p>
              <p className="settings-note">Google Sheet 模式只讀取公開資料，不要求 OAuth。</p>
              <label className="field" style={{ maxWidth: 220 }}>
                <span>自動同步間隔（秒）</span>
                <input type="number" min={5} max={600} value={c.autoSyncSeconds} onChange={(e) => set("autoSyncSeconds", e.target.value)} />
              </label>
            </SettingsCard>
          </SettingsTabPanel>

          <footer className="overlay-settings-footer">
            <Btn type="submit" className="scoreboard-save-button" disabled={saving}>
              <span aria-hidden="true">✓</span>
              {saving ? "儲存中…" : saved ? "已儲存" : "儲存並同步比分板"}
            </Btn>
          </footer>
        </form>
      </OverlayEditor>
    </OverlaySettingsPage>
  );
}