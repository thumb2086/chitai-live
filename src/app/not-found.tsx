import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "#059669",
            lineHeight: 1,
          }}
        >
          404
        </div>
        <h1 style={{ margin: "14px 0 8px", fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
          找不到這個頁面
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 14, lineHeight: 1.65, color: "#64748b" }}>
          網址可能打錯了，或這個頁面已經不存在。
        </p>
        <Link
          href="/dashboard"
          className="primary-button"
          style={{ display: "inline-flex", textDecoration: "none" }}
         prefetch={false}>
          回控制中心
        </Link>
      </div>
    </div>
  );
}