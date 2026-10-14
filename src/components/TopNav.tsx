"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import AuthModal from "./AuthModal";
import { api } from "@/lib/api";

export default function TopNav() {
  const pathname = usePathname();
  const [userName, setUserName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.getUser()
      .then((u) => setUserName(u?.name || ""))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <header className="top-nav">
      <Link href="/dashboard" data-link="" className="logo-link" aria-label="熾台 CHITAI 控制中心">
        <Image
          src="/logo.svg"
          alt="熾台 CHITAI"
          width={32}
          height={32}
          className="logo-icon"
        />
        <span className="logo-text">熾台 控制中心</span>
      </Link>

      <nav className="top-nav-links" aria-label="控制台快捷入口">
        <Link
          href="/dashboard"
          data-link=""
          className={`top-nav-entry${pathname === "/dashboard" ? " is-active" : ""}`}
          aria-current={pathname === "/dashboard" ? "page" : undefined}
        >
          <span>控制中心</span>
        </Link>
      </nav>

      <div className="user-menu">
        {ready && userName && <span className="user-name">{userName}</span>}
        {ready && userName ? (
          <button type="button" className="ghost-button top-nav-button" onClick={logout}>
            登出
          </button>
        ) : (
          !ready && <span />
        )}
        {!userName && ready && <AuthModal />}
      </div>
    </header>
  );
}