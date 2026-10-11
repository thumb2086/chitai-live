"""在**真實 Next.js 頁面**上驗證本機字幕引擎整合。

前面測過的：
  · daemon 腳本測（Node）         → 連得上、字對
  · 瀏覽器測（我寫的獨立 HTML）    → PNA 可通
但都**沒有**測過真正的前端：captions-local.ts 有沒有正確接上
createLiveCaptions、Engine 型別擴充後 UI 有沒有壞、狀態有沒有正確顯示。

這個測的是：
  1. 字幕設定頁能開（local 選項有出現）
  2. 選 local 後會顯示 daemon 狀態
  3. 頁面沒有 console error（型別沒壞、hydration 沒壞）

刻意**不**按「開始錄音」：headless 沒有麥克風，會卡在 getUserMedia。
要看真的字幕效果，用真實瀏覽器 + 麥克風。
"""

import asyncio
from playwright.async_api import async_playwright

URL = "http://localhost:3111/dashboard/subtitles"


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True, channel="chrome",
                                      args=["--no-sandbox", "--disable-gpu"])
        ctx = await b.new_context(permissions=["microphone"],
                                  ignore_https_errors=True)
        page = await ctx.new_page()

        errors, console_errs = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: console_errs.append(m.text)
                if m.type == "error" else None)

        print(f"  開啟 {URL}")
        await page.goto(URL, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(2500)

        title = await page.title()
        body = await page.inner_text("body")
        print(f"  title: {title}")
        print(f"  頁面長度: {len(body)} 字")

        # 有沒有卡在登入 / 錯誤頁
        if "錯誤" in body[:400] or "失敗" in body[:400] or len(body) < 200:
            print("\n  ★ 頁面可能是錯誤狀態:")
            print("   ", body[:400].replace("\n", " "))

        # 找 engine 選單
        selects = await page.query_selector_all("select")
        print(f"\n  頁面上有 {len(selects)} 個 select")
        for i, s in enumerate(selects):
            opts = await s.query_selector_all("option")
            vals = [(await o.inner_text()).strip() for o in opts]
            sel = await s.get_attribute("aria-label")
            print(f"    [{i}] {vals}")
            if any("本機模型" in v for v in vals):
                print(f"      ✓ 找到「本機模型」選項")

        # 切到 local
        target = None
        for s in selects:
            opts = await s.query_selector_all("option")
            for o in opts:
                if "本機模型" in (await o.inner_text()):
                    target = s
                    break
            if target:
                break

        if target is None:
            print("\n  ★ 找不到本機引擎選項")
        else:
            await target.select_option("local")
            print("\n  已切換到 local")
            await page.wait_for_timeout(2500)

            note = await page.query_selector(".settings-note")
            if note:
                print(f"  狀態說明: {(await note.inner_text())[:150]}")

            inputs = await page.query_selector_all("input[type=text]")
            for inp in inputs:
                v = await inp.input_value()
                if "ws" in v or "8765" in v:
                    print(f"  ✓ 位址欄位: {v}")

            body2 = await page.inner_text("body")
            if "本機服務" in body2 or "caption_daemon" in body2:
                print("  ✓ 頁面顯示 daemon 狀態")

        print("\n  ── console errors ──")
        real = [e for e in console_errs
                if "404" not in e and "favicon" not in e.lower()]
        if real:
            for e in real[:10]:
                print(f"    {e[:150]}")
        else:
            print("    （無）")

        print("  ── page errors ──")
        if errors:
            for e in errors[:10]:
                print(f"    {e[:200]}")
        else:
            print("    （無）")

        await page.screenshot(path="subtitles_local.png", full_page=True)
        print("\n  截圖: subtitles_local.png")

        await b.close()


asyncio.run(main())
