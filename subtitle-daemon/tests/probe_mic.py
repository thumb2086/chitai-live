"""在瀏覽器裡直接量麥克風的原始 PCM RMS。

矛盾點：captions-local 的 onLevel 回報「精確 0」，
但同一批 frames 餵給 daemon 卻轉出正確字幕。
兩者不可能同時為真 —— 找出是「量測錯」還是「送出的音訊錯」。
"""

import asyncio, subprocess
from pathlib import Path
from playwright.async_api import async_playwright

BASE = Path(r"C:\Users\CPXru\AppData\Local\Temp\opencode\asr")
fake = BASE / "_fake_mic.wav"

JS = """
async () => {
  const s = await navigator.mediaDevices.getUserMedia({audio: {channelCount:1}});
  const ctx = new AudioContext();
  await ctx.resume();
  const src = ctx.createMediaStreamSource(s);

  const got = { ctxRate: ctx.sampleRate, frames: [], errors: [] };
  try {
    const url = URL.createObjectURL(new Blob([`
      class P extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0] && inputs[0][0];
          if (ch && ch.length) {
            let sum = 0;
            for (let i=0;i<ch.length;i++) sum += ch[i]*ch[i];
            this.port.postMessage({n: ch.length, rms: Math.sqrt(sum/ch.length),
                                   peak: Math.max(...Array.from(ch).map(Math.abs))});
          }
          return true;
        }
      }
      registerProcessor('probe', P);
    `], {type:'application/javascript'}));
    await ctx.audioWorklet.addModule(url);
    const n = new AudioWorkletNode(ctx, 'probe');
    n.port.onmessage = (e) => got.frames.push(e.data);
    src.connect(n);
    const mute = ctx.createGain(); mute.gain.value = 0;
    n.connect(mute).connect(ctx.destination);
    await new Promise(r => setTimeout(r, 6000));
  } catch (e) { got.errors.push(String(e)); }
  s.getTracks().forEach(t => t.stop());
  await ctx.close();

  const f = got.frames;
  const rms = f.map(x => x.rms).sort((a,b)=>a-b);
  return {
    ctxRate: got.ctxRate,
    frameCount: f.length,
    errors: got.errors,
    rmsMax: rms.length ? rms[rms.length-1] : null,
    rmsMedian: rms.length ? rms[Math.floor(rms.length/2)] : null,
    peakMax: f.length ? Math.max(...f.map(x=>x.peak)) : null,
    first8: f.slice(0,8).map(x => ({n: x.n, rms: +x.rms.toFixed(5)})),
  };
}
"""


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(
            headless=True, channel="chrome",
            args=["--no-sandbox", "--disable-gpu",
                  "--use-fake-ui-for-media-stream",
                  "--use-fake-device-for-media-stream",
                  f"--use-file-for-fake-audio-capture={fake}"])
        ctx = await b.new_context(permissions=["microphone"])
        page = await ctx.new_page()
        # 必須是 secure context 才拿得到 mediaDevices。
        # about:blank 是 opaque origin → navigator.mediaDevices 直接是 undefined。
        await page.goto("http://localhost:3111/caplocalprobe",
                        wait_until="domcontentloaded", timeout=60000)
        r = await page.evaluate(JS)
        print("  ── 瀏覽器實測麥克風 ──")
        for k, v in r.items():
            print(f"    {k}: {v}")
        await b.close()

asyncio.run(main())
