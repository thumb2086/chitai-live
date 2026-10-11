"""PNA 實測：用真實瀏覽器（Playwright + 已安裝的 Chrome）開 HTTPS 頁面，
連 ws://127.0.0.1:8765。

為什麼非用真瀏覽器不可
──────────────────────
Node / Python 測 WebSocket **不會**觸發 Chrome 的 Private Network Access。
那條規則是瀏覽器層的（同源政策 + PNA）。所以腳本測成功完全不代表
使用者的瀏覽器會成功 —— 而 dashboard 是 https，這個組合正是會被管的。

放棄的兩條路
────────────
1. headless Chrome --dump-dom：拿不到 DOM（自簽憑證 + headless 組合不穩）
2. open_browser_use：ERR_CERT_AUTHORITY_INVALID，沒有略過憑證驗證的選項
   → 這是**工具限制**，不是被測系統的問題，不要誤判成 PNA 被擋

改用 Playwright，帶 ignore_https_errors，並且直接**攔截請求層級的錯誤**，
這樣即使 WebSocket 被擋，也能看到是「preflight 被拒」還是「連線被拒」。
"""

import asyncio
from playwright.async_api import async_playwright

TARGET_WS = "ws://127.0.0.1:8765/ws"
PAGE = "https://127.0.0.1:9443/"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            channel="chrome",            # 用已安裝的 Chrome，不用下載 chromium
            args=["--no-sandbox", "--disable-gpu"],
        )
        ctx = await browser.new_context(ignore_https_errors=True)
        page = await ctx.new_page()

        console = []
        page.on("console", lambda m: console.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))

        # 攔截所有請求，看 daemon 到底收到什麼
        requests = []

        def on_req(r):
            if "8765" in r.url:
                requests.append(f"→ {r.method} {r.url}")

        page.on("request", on_req)
        page.on("requestfailed", lambda r: requests.append(
            f"✗ FAILED {r.url}  {r.failure}") if "8765" in r.url else None)

        print(f"  頁面: {PAGE}")
        print(f"  目標: {TARGET_WS}\n")
        print(f"  page origin = {await page.evaluate('location.origin')}")
        print(f"  secureContext = {await page.evaluate('isSecureContext')}")
        print()

        await page.goto(PAGE, wait_until="domcontentloaded")

        # 等頁面上的 __done 或 8 秒
        try:
            await page.wait_for_function("window.__done === true", timeout=9000)
        except Exception:
            pass

        out = await page.inner_text("#o")
        print("  ── 頁面回報 ──")
        for line in out.splitlines():
            print(f"    {line}")

        print("\n  ── 網路層攔截 ──")
        if requests:
            for r in requests[:20]:
                print(f"    {r}")
        else:
            print("    （完全沒有請求飛出去 → 瀏覽器在送出前就擋了）")

        if console:
            print("\n  ── console ──")
            for c in console[:15]:
                print(f"    {c}")

        ok = "WS OPEN" in out
        print("\n  " + ("✓ HTTPS 頁面可以連本機 daemon — 架構可行"
                        if ok else "★ 被擋 — 需要調整架構"))

        await browser.close()


asyncio.run(main())
