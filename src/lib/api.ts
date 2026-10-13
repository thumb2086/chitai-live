const BASE = "/api/v1";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  seed: () => req<{ ok: boolean; userId: string }>("/seed", { method: "POST" }),

  getUser: () => req<any>("/user"),
  updateUser: (data: any) => req<any>("/user", { method: "PATCH", body: JSON.stringify(data) }),

  getChat: () => req<any>("/chat"),
  saveChat: (data: any) => req<any>("/chat", { method: "PUT", body: JSON.stringify(data) }),

  getSubtitles: () => req<any>("/subtitles"),
  saveSubtitles: (data: any) => req<any>("/subtitles", { method: "PUT", body: JSON.stringify(data) }),

  getDonations: () => req<any>("/donations"),
  addGoal: (data: any) => req<any>("/donations", { method: "POST", body: JSON.stringify({ _meta: "addGoal", ...data }) }),
  updateGoal: (data: any) => req<any>("/donations", { method: "POST", body: JSON.stringify({ _meta: "updateGoal", ...data }) }),
  deleteGoal: (id: string) => req<any>("/donations", { method: "POST", body: JSON.stringify({ _meta: "deleteGoal", id }) }),
  updateDonationMeta: (data: any) => req<any>("/donations", { method: "POST", body: JSON.stringify({ _meta: "updateUser", ...data }) }),
  simulateDonation: (amount: number) => req<any>("/donations", { method: "POST", body: JSON.stringify({ _meta: "simulate", amount }) }),

  getOBS: () => req<{ sources: any[] }>("/obs"),
  toggleOBS: (id: string, enabled: boolean) => req<{ sources: any[] }>("/obs", { method: "POST", body: JSON.stringify({ _meta: "toggle", id, enabled }) }),
  regenerateOBS: (id: string) => req<{ sources: any[] }>("/obs", { method: "POST", body: JSON.stringify({ _meta: "regenerate", id }) }),

  getStats: () => req<any>("/stats"),
  addSession: (data: any) => req<any>("/stats", { method: "POST", body: JSON.stringify({ _meta: "add", ...data }) }),
  deleteSession: (id: string) => req<any>("/stats", { method: "POST", body: JSON.stringify({ _meta: "delete", id }) }),

  getConnections: () => req<Record<string, { connected: boolean; channelName: string | null; channelAvatar: string | null }>>("/connections"),
  toggleConnection: (platform: string, connected: boolean) => req<Record<string, { connected: boolean; channelName: string | null; channelAvatar: string | null }>>("/connections", { method: "POST", body: JSON.stringify({ _meta: "toggle", platform, connected }) }),
  refreshConnection: (platform: string) => req<Record<string, { connected: boolean; channelName: string | null; channelAvatar: string | null }>>("/connections", { method: "POST", body: JSON.stringify({ _meta: "refresh", platform }) }),

  getOnboard: () => req<any>("/onboard"),
  saveOnboard: (data: any) => req<any>("/onboard", { method: "POST", body: JSON.stringify(data) }),

  zixiProxy: (data: any) => req<any>("/zixi/proxy", { method: "POST", body: JSON.stringify(data) }),
  zixiCheckTx: () => req<any>("/zixi/check-tx", { method: "POST" }),
  getZixiDonations: () => req<any>("/zixi-donations"),

  getCommands: () => req<{ commands: any[] }>("/commands"),
  addCommand: (data: any) => req<{ commands: any[] }>("/commands", { method: "POST", body: JSON.stringify({ _meta: "add", ...data }) }),
  updateCommand: (data: any) => req<{ commands: any[] }>("/commands", { method: "POST", body: JSON.stringify({ _meta: "update", ...data }) }),
  toggleCommand: (id: string, enabled: boolean) => req<{ commands: any[] }>("/commands", { method: "POST", body: JSON.stringify({ _meta: "toggle", id, enabled }) }),
  deleteCommand: (id: string) => req<{ commands: any[] }>("/commands", { method: "POST", body: JSON.stringify({ _meta: "delete", id }) }),

  // 抽獎：後端 13 個端點早就有了，但這裡一直沒接（前端缺頁面）。
  //
  // ⚠️ draw / join / clear 的隨機與所有權都在**伺服器端**：
  //    · draw 的隨機數由伺服器產生（前端抽就能重複抽）
  //    · join / draw / clear 都檢查 giveaway 屬於自己
  //    這裡只是薄封裝，不要把那些邏輯搬到前端。
  getGiveaways: () => req<{ giveaways: any[] }>("/giveaways"),
  addGiveaway: (data: { title: string; keyword?: string }) =>
    req<{ giveaways: any[] }>("/giveaways", { method: "POST", body: JSON.stringify({ _meta: "add", ...data }) }),
  toggleGiveaway: (id: string, enabled: boolean) =>
    req<{ giveaways: any[] }>("/giveaways", { method: "POST", body: JSON.stringify({ _meta: "toggle", id, enabled }) }),
  deleteGiveaway: (id: string) =>
    req<{ giveaways: any[] }>("/giveaways", { method: "POST", body: JSON.stringify({ _meta: "delete", id }) }),
  joinGiveaway: (id: string, name: string) =>
    req<{ giveaways: any[] }>("/giveaways", { method: "POST", body: JSON.stringify({ _meta: "join", id, name }) }),
  drawGiveaway: (id: string) =>
    req<{ giveaways: any[] }>("/giveaways", { method: "POST", body: JSON.stringify({ _meta: "draw", id }) }),
  clearGiveaway: (id: string) =>
    req<{ giveaways: any[] }>("/giveaways", { method: "POST", body: JSON.stringify({ _meta: "clear", id }) }),
};
