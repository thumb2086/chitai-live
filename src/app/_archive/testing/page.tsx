"use client";

import { useState, useRef, useEffect } from "react";
import { FlaskConical, Send, Eye, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

export default function TestingPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [donationInput, setDonationInput] = useState("");
  const [donationAmount, setDonationAmount] = useState("100");
  const [obsSources, setObsSources] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    Promise.all([api.getUser(), api.getOBS()])
      .then(([u, o]) => {
        setUserData(u);
        setObsSources(o.sources);
        setAutoMode(u.demoMode ?? false);
      })
      .catch(() => setError("載入失敗"));
  }, []);

  const chatNames = ["小明", "阿花", "直播迷", "新觀眾", "老粉絲", "路人甲", "鐵粉"];
  const chatColors = ["text-purple-400", "text-blue-400", "text-green-400", "text-pink-400", "text-yellow-400"];

  const toggleAutoMode = async () => {
    setNotice(null); setError(null);
    const next = !autoMode;
    setAutoMode(next);
    await api.updateUser({ demoMode: next }).catch(() => {});
    // Removed: this reloaded every iframe[src*="/overlay/"] on the page. This page
    // has no iframes -- previews are <a target="_blank"> -- so the loop was a
    // guaranteed no-op that looked like it did something.
  };

  useEffect(() => {
    if (autoMode) {
      intervalRef.current = setInterval(() => {
        setMessages(prev => {
          const isDonation = Math.random() > 0.7;
          const user = chatNames[Math.floor(Math.random() * chatNames.length)];
          const text = ["Nice!", "加油！", "哈哈哈", "讚讚", "77777", "好強喔", "LOL"][Math.floor(Math.random() * 7)];
          const newMsg: any = isDonation
            ? { type: "donation", user: "匿名贊助", text: "繼續加油！", amount: Math.floor(Math.random() * 500) + 50 }
            : { type: "chat", user, text, amount: undefined };
          fetch("/api/v1/chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "twitch", userName: user, message: text }) }).catch(() => {});
          return [...prev.slice(-50), newMsg];
        });
      }, 6000);
    } else { if (intervalRef.current) clearInterval(intervalRef.current); }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoMode]);

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    setMessages(prev => [...prev, { type: "chat", user: "測試者", text: chatInput }]);
    await fetch("/api/v1/chat/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "twitch", userName: "測試者", message: chatInput }),
    }).catch(() => {});
    setChatInput("");
  };
  const sendDonation = async () => {
    if (!donationInput.trim()) return;
    const amount = parseInt(donationAmount) || 100;
    setMessages(prev => [...prev, { type: "donation", user: "測試贊助者", text: donationInput, amount }]);
    await api.simulateDonation(amount).catch(() => {});
    // Also create a ZixiDonation record so the alerts overlay shows it
    try {
      const zixiRes = await fetch("/api/v1/zixi-donations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userData?.username || "creator", donorAddress: "0xTestDonor", amount, token: "ZXC", message: donationInput, isTest: true }),
      });
      if (zixiRes.ok) setNotice("✅ 測試斗內已送出！重整 overlay 即可看到");
      else setNotice(await zixiRes.text().then(t => { try { return JSON.parse(t).error || "斗內記錄失敗"; } catch { return "斗內記錄失敗"; } }));
    } catch { setNotice("⚠️ 伺服器連線失敗，請重整後重試"); }
    setDonationInput("");
  };

  // The payload field is `key`, not `sourceKey`, so this never matched -- and
  // the lookup values below are route *paths* (subtitles, donations, alerts,
  // stats) while the registered overlay keys are captions, donation-goal,
  // donation-alert, channel-stats. Both halves were wrong, so getUrl always
  // returned null: every "Overlay 測試網址" row rendered "（未啟用）" with no
  // copy button, and the whole 快速連結 sidebar rendered nothing.
  const getUrl = (key: string) => {
    const src = obsSources.find((s: any) => s.key === key);
    if (!src) return null;
    // The API already returns an absolute url; prefer it over rebuilding here.
    return src.url ?? `${origin}/overlay/${src.path ?? key}/${src.token}`;
  };

  return (
    <div className="max-w-[1080px]">
      {error && <div className="mb-4 rounded-[var(--ic-radius-md)] border border-red-200 bg-red-50 p-3 text-[13px] text-red-600">{error}</div>}
      {notice && <div className="mb-4 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-2)] p-3 text-[13px] text-[var(--ic-ink-subtle)]">{notice}</div>}
      <div className="mb-4 text-[13px] text-[var(--ic-ink-subtle)]">
        <a href="/dashboard" className="text-[var(--ic-primary)] no-underline">控制中心</a>
        <span className="mx-2 text-[var(--ic-ink-muted)]">/</span>
        <span className="text-[var(--ic-ink-muted)]">測試與整合</span>
      </div>
      <div className="mb-6 grid gap-2">
        <h1 className="text-[34px] font-[500] leading-[1.12] text-[var(--ic-ink)]">測試與整合</h1>
        <p className="max-w-[520px] text-[14px] leading-[1.6] text-[var(--ic-ink-muted)]">測試疊加層顯示效果。</p>
      </div>
      <div className="grid grid-cols-[1fr_290px] gap-6 items-start max-lg:grid-cols-1">
        <div className="grid gap-3.5 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-6">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">模擬工具</span>
            <div className="flex items-center gap-2">
              <button onClick={toggleAutoMode}
                className={`min-h-[32px] rounded-[999px] px-3 text-[12px] font-[500] transition-all ${autoMode ? "border border-transparent bg-green-600 text-white" : "border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] text-[var(--ic-ink)]"}`}>
                {autoMode ? "自動模擬中..." : "自動模擬"}
              </button>
              <button onClick={() => { setMessages([]); fetch("/api/v1/chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "twitch", message: "__clear__", names: [...chatNames, "系統", "測試者", "測試贊助者"] }) }).catch(() => {}); }} className="flex min-h-[32px] items-center gap-1 rounded-[999px] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 text-[12px] font-[500] text-[var(--ic-ink)] hover:border-red-200 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" /> 清空
              </button>
            </div>
          </div>
          <div className="grid gap-4">
            <div className="grid gap-1">
              <span className="text-[12px] font-[500] text-[var(--ic-ink-muted)]">模擬聊天室訊息</span>
              <div className="flex gap-2">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()}
                  placeholder="輸入測試內容..." className="flex-1 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none" />
                <button onClick={sendChat} className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--ic-radius-md)] border border-transparent bg-[var(--ic-primary)] px-3.5 text-[13px] font-[500] text-white"><Send className="h-4 w-4" /> 發送</button>
              </div>
            </div>
            <div className="grid gap-1">
              <span className="text-[12px] font-[500] text-[var(--ic-ink-muted)]">模擬斗內（同步寫入資料庫）</span>
              <div className="flex gap-2">
                <input value={donationInput} onChange={e => setDonationInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendDonation()}
                  placeholder="斗內訊息..." className="flex-1 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none" />
                <input type="number" value={donationAmount} onChange={e => setDonationAmount(e.target.value)} className="w-24 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-3 py-2.5 text-[14px] text-[var(--ic-ink)] outline-none" />
                <button onClick={sendDonation} className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--ic-radius-md)] border border-transparent bg-[var(--ic-fin-orange)] px-3.5 text-[13px] font-[500] text-white"><Send className="h-4 w-4" /> 斗內</button>
              </div>
            </div>
          </div>
          <div className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-canvas)] p-3">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-[500] text-[var(--ic-ink-muted)]">
              <Eye className="h-4 w-4" /> 即時預覽
            </div>
            <div className="grid max-h-[200px] gap-1.5 overflow-y-auto rounded-[var(--ic-radius-md)] bg-black/80 p-3">
              {messages.map((m, i) => (
                <div key={i} className="flex items-start gap-2 text-[13px]">
                  {m.type === "donation" ? <><strong className="text-orange-400">贊助:</strong><span className="text-yellow-200">{m.text}</span><span className="text-[var(--ic-fin-orange)]">ZXC {m.amount}</span></>
                    : <><strong className={chatColors[i % chatColors.length]}>{m.user}:</strong><span className="text-white">{m.text}</span></>}
                </div>
              ))}
              {messages.length === 0 && <div className="py-4 text-center text-[13px] text-[var(--ic-ink-muted)]">尚無訊息</div>}
            </div>
          </div>
          <div className="mt-2">
            <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">Overlay 測試網址</span>
            <div className="mt-2 grid gap-2.5">
              {[
                { label: "聊天室疊加層", key: "chat" },
                { label: "字幕疊加層", key: "captions" },
                { label: "斗內進度條", key: "donation-goal" },
                { label: "斗內通知", key: "donation-alert" },
                { label: "頻道統計", key: "channel-stats" },
              ].map((item) => {
                const url = getUrl(item.key);
                return (
                  <div key={item.key} className="flex items-center gap-2 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-canvas)] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ic-ink-muted)]">
                      <strong className="text-[var(--ic-ink)]">{item.label}:</strong> {url || "（未啟用）"}
                    </span>
                    {url && <button onClick={() => navigator.clipboard.writeText(url)} className="flex-shrink-0 rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] px-2.5 py-1 text-[11px] font-[500] text-[var(--ic-ink)] hover:border-[var(--ic-hairline-strong)]">複製</button>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="sticky top-[82px] grid gap-3.5 rounded-[var(--ic-radius-lg)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-[22px]">
          <span className="text-[12px] font-[500] uppercase tracking-[0.04em] text-[var(--ic-ink-subtle)]">快速連結</span>
              {["chat", "donations", "subtitles", "alerts", "stats"].map(key => {
            const url = getUrl(key);
            const labels: Record<string, string> = { chat: "聊天室", donations: "斗內進度", subtitles: "字幕疊加層", alerts: "斗內通知", stats: "統計" };
            if (!url) return null;
            return url ? (
              <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                className="flex w-full items-center justify-center rounded-[var(--ic-radius-md)] border border-transparent bg-[var(--ic-primary)] px-3 py-2.5 text-[13px] font-[500] text-white transition-all hover:bg-[var(--ic-primary-hover)] no-underline">
                開啟{labels[key]}預覽
              </a>
            ) : null;
          })}
          <div className="rounded-[var(--ic-radius-md)] border border-[var(--ic-hairline)] bg-[var(--ic-surface-3)] p-3">
            <strong className="text-[13px] text-[var(--ic-ink)]">注意</strong>
            <p className="mt-1 text-[12px] text-[var(--ic-ink-muted)]">Overlay 顯示的是真實疊加層內容。要看到測試訊息，請開啟「自動模擬」並重整 overlay 頁面。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
