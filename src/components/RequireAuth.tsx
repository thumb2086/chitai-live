"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("https://api.zixilive.dpdns.org/api/v1/user")
      .then(r => { if (r.ok) setOk(true); else router.replace("/"); })
      .catch(() => router.replace("/"));
  }, []);

  if (!ok) return <div className="flex min-h-screen items-center justify-center bg-[var(--ic-canvas)] text-[14px] text-[var(--ic-ink-muted)]">驗證中...</div>;
  return <>{children}</>;
}
