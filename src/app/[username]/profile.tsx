"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";

export default function PublicProfileClient({ username }: { username: string }) {
  const [user, setUser] = useState<any>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`https://api.zixilive.dpdns.org/api/v1/user/by-username/${encodeURIComponent(username)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("nf"))))
      .then((d) => setUser(d?.data ?? d))
      .catch(() => setMissing(true));
  }, [username]);

  if (missing) notFound();
  if (!user) {
    return (
      <main className="min-h-screen bg-[var(--ic-canvas)] px-5 py-24 text-center text-[14px] text-[var(--ic-ink-muted)]">
        載入中…
      </main>
    );
  }

  const live = (user.connections || []).some((c: any) => c.connected);

  return (
    <main className="min-h-screen bg-[var(--ic-canvas)] px-5 py-16">
      <div className="mx-auto max-w-2xl rounded-3xl border border-[var(--ic-hairline)] bg-[var(--ic-surface-1)] p-8 text-center shadow-sm">
        {user.avatar && (
          <img src={user.avatar} alt="" width={96} height={96} className="mx-auto h-24 w-24 rounded-full object-cover" />
        )}
        <h1 className="mt-5 text-2xl font-[750] tracking-tight text-[var(--ic-ink)]">{user.name}</h1>
        <p className="mt-1 text-[13px] text-[var(--ic-ink-muted)]">@{username}</p>
        <span className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-[600] ${live ? "bg-[rgba(220,38,38,.1)] text-[var(--ic-danger,#b91c1c)]" : "bg-[var(--ic-surface-3)] text-[var(--ic-ink-muted)]"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-[var(--ic-danger,#dc2626)]" : "bg-current opacity-50"}`} />
          {live ? "直播中" : "目前未開台"}
        </span>
        <div className="mt-8 border-t border-[var(--ic-hairline)] pt-6">
          <p className="text-[13px] text-[var(--ic-ink-muted)]">來自熾台 CHITAI · 一站式直播工具</p>
          <a href="https://api.zixilive.dpdns.org/api/auth/youtube" className="mt-4 inline-block rounded-full bg-black px-5 py-2.5 text-[13px] font-[650] text-white no-underline hover:bg-black/85">
            用 Google 登入開始自己的直播
          </a>
        </div>
      </div>
    </main>
  );
}
