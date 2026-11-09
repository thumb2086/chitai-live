"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const qt = q.get("token");
      if (qt) {
        localStorage.setItem("chitai_token", qt);
        document.cookie = `token=${qt}; path=/; max-age=604800`;
        q.delete("token");
        const clean = `${window.location.pathname}${q.toString() ? "?" + q.toString() : ""}${window.location.hash}`;
        window.history.replaceState(null, "", clean);
      }
    } catch {}
    const token = localStorage.getItem("chitai_token") || (document.cookie.match(/token=([^;]+)/)?.[1] ?? "");
    fetch("https://api.zixilive.dpdns.org/api/v1/user", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => { if (r.ok) setOk(true); else router.replace("/"); })
      .catch(() => router.replace("/"));
  }, []);

  if (!ok) return <div className="flex min-h-screen items-center justify-center bg-[var(--ic-canvas)] text-[14px] text-[var(--ic-ink-muted)]">檢查登入中…</div>;
  return <>{children}</>;
}