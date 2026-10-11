# 本機即時字幕（x-asr）

把即時字幕從雲端 Groq 搬到**自己電腦**跑。音訊不出網路，零 API 費用。

## 怎麼用

1. 啟動一次（開機自動啟動可以做成排程）：
   ```
   subtitle-daemon\dist\ZixiCaption\ZixiCaption.exe
   ```
   第一次會載入模型（約 2.2 秒），出現 `✓ 就绪 ws://127.0.0.1:8765` 就算好了。

2. 開字幕設定頁 →「語音辨識服務」選 **本機模型** → 開始錄音。

頁面會顯示本機服務狀態；沒啟動時「開始錄音」按鈕會是停用狀態。

## 關於 GPU

**本機跑的是 CPU，不是 GPU。** 這是實測確認的，不是猜的：

```
$ nvidia-smi
NVIDIA GeForce RTX 3060 Ti, 8192 MiB          ← 有 GPU

$ python -c "import onnxruntime; print(onnxruntime.get_available_providers())"
['TensorrtExecutionProvider', 'CUDAExecutionProvider', 'CPUExecutionProvider']   ← ORT 有 CUDA

$ ZixiCaption.exe --provider cuda
⚠ 你要求了 cuda，但這個 sherpa-onnx 沒有編譯 GPU 支援，已自動改用 CPU
  session.cc:GetSessionOptionsImpl:355 Please compile with -DSHERPA_ONNX_ENABLE_GPU=ON.
  Available providers: CPUExecutionProvider, . Fallback to cpu!
```

pip 上的 `sherpa-onnx` 套件**沒有編譯 GPU 支援**（GPU 是編譯期選項 `-DSHERPA_ONNX_ENABLE_GPU=ON`）。

⚠️ 這是**靜默降級**：傳 `provider="cuda"` 不會報錯、也不會變慢，看起來像成功了，
實際上還在跑 CPU。我第一次量到「CPU 333ms / CUDA 332ms」就誤以為「GPU 沒比較快」——
其實是兩個都在跑 CPU。**參數有送到 ≠ 有生效**，這點和 AGENTS.md 記的教訓一樣。

所以 daemon 會攔截原生庫的 log 來判斷，實際生效的後端寫在 `/health` 的 `provider` 欄，
前端也顯示那個值而不是你要求的值。

### 那到底該不該開 GPU？

即使換成有 GPU 支援的 sherpa-onnx，**對字幕延遲也沒幫助**：

| | 數值 |
|---|---|
| 單窗推論（CPU，4 執行緒） | 271~333 ms |
| 預算（1.2s 步進） | 1200 ms |
| **真正瓶頸：模型暖機** | **3.4 秒** |

推論只吃掉預算的 1/4，瓶頸是模型架構決定的前置語音量，GPU 幫不上。
開 GPU 的實際收益是「省 CPU」，不是「字幕更快」。

要開的話得自己編譯 sherpa-onnx（`-DSHERPA_ONNX_ENABLE_GPU=ON`），
而且打包要多 517 MB（CUDA provider + nvrtc + thrust/cub）。不建議。

## 怎麼確認它真的在跑

瀏覽器開 `http://127.0.0.1:8765/health`：

```json
{"ok":true,"model":"sherpa-onnx-x-asr-160ms-...","load_s":2.5,"uptime_s":120,"connections":1}
```

`connections` 會隨著開著的字幕分頁數變動。

## 實測數字（真實台灣 Podcast，逐字稿比對）

| 項目 | 數值 | 備註 |
|---|---|---|
| CER | **11~12%** | 12 組可信樣本；同一批對照的雲端模型 12.3~20.3% |
| 標點 | **15.2 個/分鐘** | 其他候選模型都是 **0** |
| 首字延遲 | 中位 **3.4 秒** | 只在開頭發生一次 |
| 後續更新 | 每 **160ms** | 5~10 字/秒，跟得上真人語速 |
| 首個定稿 | 中位 **5.9 秒** | 存檔用 |
| 定稿間隔 | 中位 **3.0 秒** | |
| 繁體 | OpenCC `s2twp` | 模型輸出簡體，一律轉繁體 |
| 單窗耗時 | 271 ms / 2.4s | 預算 1200ms |

**「首字 3.4 秒」要正確解讀**：那是一次性開機成本。第 2 句起每 160ms 就更新一次。

### 跟 Groq 的比較（誠實版）

Groq 設定頁顯示的 `latencyMs` 只有 300~600ms，但那是**伺服器往返**。
它還要等視窗：一句話講完在 T，被包含在「結束時間 > T 的第一個視窗」，
最多多等 1 個 step（1.2 秒）。

- Groq 感知延遲 ≈ **0.5 ~ 1.7 秒**
- 本機感知延遲 ≈ **3.4 秒（開頭）**，之後即時

本機慢一截，換來的是：**零費用、零額度限制、音訊不出電腦、有標點、繁體**。

## 架構

```
瀏覽器 16kHz PCM
   → WebSocket  ws://127.0.0.1:8765/ws      ← 注意是 localhost，不是 127.0.0.1
   → caption_daemon.py
   → sherpa-onnx  x-asr 160ms 串流 transducer
   → OpenCC s2twp（簡→繁）
   → partial / final 事件回瀏覽器
```

### 為什麼不用視窗切分

Groq 只有離線 API，必須湊一段音訊，所以要「2.4 秒視窗 / 1.2 秒步進」反覆重疊送
（見 `captions-live.ts`）。本機跑的是**真串流**模型，音訊餵進去就持續吐字，
整套視窗／步進／去重都不需要。

### 兩種事件

| 事件 | 意義 | 前端怎麼處理 |
|---|---|---|
| `partial` | 模型目前的完整假設（含所有標點） | 直接取代畫面 |
| `final` | 已定稿，之後不會再改 | 追加到存檔 |
| `final` + `rewrite:true` | 模型回頭改了前文，**整句重送** | **取代**，不是追加 |

### 定稿規則（`caption_daemon.py`）

1. 句尾標點（。！？），且後面已有多 4 個字 → 在那切
2. 軟標點（，、；：）同上
3. 都沒有 → 累積到 26 字，或這段已「講／待」超過 3 秒 → 強制切

規則 3 是保險。沒有它，長句會等到整句講完（實測最長 19.4 秒）。

## 已知限制

- **語音模型會回頭改寫**。約每 37 秒音訊發生一次，前端已正確處理
  （`rewrite` 會取代），但存檔會多一筆修正紀錄。
- **逐字稿對齊是我自己的量測**。資料夾裡部分集的逐字稿內容與檔名不符，
  量 CER 前會先用相似度篩掉對不上的樣本。
- **`next dev` 起不來**（`@vercel/turbopack-next` 缺字體模組），
  但 `next build` / `next start` 正常。這是既有问题，跟本功能無關。

## 檔案

```
subtitle-daemon/
  caption_daemon.py       daemon 本體
  caption_daemon.spec     PyInstaller 打包設定（排除 TensorFlow/CUDA，1.8GB → 306MB）
  models/                 模型（161MB，已在 .gitignore）
  dist/ZixiCaption/       成品（306MB，已在 .gitignore）
    ZixiCaption.exe
    models/
  tests/                  量測腳本（見下）
```

模型沒有塞進 exe 裡 —— 用 `--onefile` 每次啟動都要解壓 161MB 到 temp，
開機會多等 10 秒以上。放旁邊則是秒開。

## 重新打包

```
cd subtitle-daemon
pip install pyinstaller
pyinstaller caption_daemon.spec --noconfirm --distpath dist --workpath build
```

spec 會自動把 `models/` 複製到 `dist\ZixiCaption\models\`。模型要另外抓：

```
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2
```

## 量測腳本（tests/）

跑之前要先啟動 daemon。這些是**實測**，不是推估。

| 腳本 | 量什麼 |
|---|---|
| `test_daemon.py` | 完整性：繁體、標點、CER、定稿連貫性、漏字率 |
| `test_browser_e2e.py` | 真實瀏覽器（HTTPS 頁）→ WebSocket → exe → 字幕進 DOM |
| `test_pna2.py` | Private Network Access：HTTPS 頁面能不能連本機 daemon |
| `first_token_real.py` | 首字延遲、首個定稿（**音訊時間**基準，不是牆鐘） |
| `continuous_stream.py` | 連續串流中每一句多久冒出字 → 證明開機成本只有一次 |
| `bench3.py` | 各候選 ASR 模型品質對比（用真實逐字稿） |
| `gpu_bench.py` | CPU vs CUDA（**會揭露靜默降級**） |
| `why_slow.py` | 模型右文脈需求 vs 實際解碼時序 |
| `trace_rewrite.py` | 追查定稿被模型回頭改寫的觸發點 |

### 為什麼要分這麼多支

每支都是因為**上一次的結論被推翻了**才生出來的：

- 「首字 89ms」量的是計算耗時 → `first_token_real.py` 改用音訊時間
- 「有標點」是照模型家族想當然 → `bench3.py` 實測
- 「GPU 沒比較快」其實是靜默降級 → `gpu_bench.py`

**逐字稿對齊**是這些腳本裡最容易出錯的地方：資料夾裡部分集的逐字稿內容與檔名不符
（檔名講「左派」內容講「健保」），量 CER 前必須先用字元集合相似度篩掉對不上的樣本，
否則會得到 98% 的假 CER。

## 開發模式（不打包）

```
python caption_daemon.py
```

需要 `sherpa-onnx`、`opencc`、`aiohttp`、`numpy`。