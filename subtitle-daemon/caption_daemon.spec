# PyInstaller spec — 打成本機字幕 daemon 的 Windows 執行檔
#
# 為什麼用 onedir 不用 onefile
# ---------------------------
# 模型 161MB。onefile 會在每次啟動時解壓到 temp：
#   · 開機多等 10 秒以上（每次都要解）
#   · 每次佔一份 161MB 暫存空間
#   · 被防毒軟體掃到時容易卡住
# onedir 是資料夾形式，秒開，比較像「安裝好就能用」。
#
# 模型**不**打包進去（add-data 會讓整包變 400MB+），
# 改由 caption_daemon.py 的 find_model_dir() 在旁邊的 models/ 找。
#
# 建置：pyinstaller caption_daemon.spec --noconfirm

import os
from pathlib import Path
from PyInstaller.building.datastruct import TOC

HERE = Path(os.path.abspath(SPECPATH))
MODEL_NAME_FOR_DIST = (
    "sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05"
)
# 模型先找專案裡的 models/，再找 spec 旁邊（開發時的舊位置）
MODEL_SRC = HERE / MODEL_NAME_FOR_DIST
if not MODEL_SRC.is_dir():
    MODEL_SRC = HERE / "models" / MODEL_NAME_FOR_DIST

a = Analysis(
    [str(HERE / "caption_daemon.py")],
    pathex=[str(HERE)],
    binaries=[],
    # sherpa-onnx / onnxruntime / opencc 都是動態載入，PyInstaller 靜態分析抓不到
    hiddenimports=[
        "sherpa_onnx",
        "sherpa_onnx.lib._sherpa_onnx",
        "onnxruntime",
        "onnxruntime.capi._pybind_state",
        "numpy",
        "aiohttp",
        "aiohttp.web",
        "opencc",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 這些會把體積灌大但用不到
        "tkinter", "matplotlib", "scipy", "pandas", "PIL",
        "pytest", "IPython", "notebook",
        # ⚠️ 這台機器上的 torch 有個讀不到的目錄（...\site-packages\torch\torch），
        #    PyInstaller 掃 site-packages 會踩到 → WinError 1920 直接中止整個 build。
        "torch", "torchaudio", "torchvision", "triton",
        # ⚠️ TensorFlow：單一個 _pywrap_tensorflow_internal.pyd 就有 697MB。
        #    字幕完全不需要它，是被某個相依套件間接帶進來的。
        #    不排除的話成品會變成 1.8GB。
        "tensorflow", "_pywrap_tensorflow_internal",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

# ── 砍掉 CUDA ──
# 我們用 sherpa_onnx.from_transducer(..., num_threads=N)，走 CPU provider。
# 但 onnxruntime 的套件裡預設帶了 CUDA provider：
#     onnxruntime_providers_cuda.dll   324 MB
#     nvrtc64_120_0.dll                 85 MB
#     thrust / cub                      108 MB
# 合計 517 MB，CPU 模式一個都用不到。
#
# 為什麼不能用 excludes 處理：這些是 DLL，不是 Python 模組，
# PyInstaller 的 excludes 只作用在模組圖上，管不到 binaries 清單。
# 只能在收集之後自己過濾。
CUDA_NOISE = (
    "onnxruntime_providers_cuda",
    "nvrtc64",
    "thrust.cp3",
    "cub.cp3",
    "cudnn", "cufft", "curand", "cusparse", "cusolver",
)


def drop_cuda(binaries):
    """binaries 是 TOC 三元組 (src, dest, typecode)，不是二元組。"""
    kept = []
    for entry in binaries:
        src, dest = entry[0], entry[1]
        name = Path(str(dest)).name.lower()
        if any(n.lower() in name for n in CUDA_NOISE):
            print(f"  [spec] 丟掉 CUDA 檔案: {Path(str(dest)).name}")
            continue
        kept.append(entry)
    return TOC(kept)


a.binaries = drop_cuda(a.binaries)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ZixiCaption",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # UPX 會被防毒軟體誤判，不要
    console=True,       # 主播要看 log（第一次啟動尤其需要）
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="ZixiCaption",
)

# ── 把模型複製進成品旁邊 ──
#
# 為什麼不在 Analysis 裡用 datas 一起打包？
#   · 會讓 PyInstaller 每個檔案都做雜湊追蹤，161MB 要等很久
#   · 而且 COLLECT 之後再複製，模型就不在 _internal 裡，
#     目錄結構乾淨（使用者看到 models/ 就知道那是模型，可以單獨搬走）
#
# ⚠️ 這裡不複製的話，使用者拿到的是「找不到模型」的 exe ——
#    而且第一次發現時只會看到亂碼錯誤訊息。
import shutil

# MODEL_SRC 在檔案開頭就決定好了（會先找 models/ 再找 spec 旁邊）
# distpath 由 --distpath 決定，預設是 ./dist
MODEL_DST = HERE / "dist" / "ZixiCaption" / "models" / MODEL_NAME_FOR_DIST

if MODEL_SRC.is_dir():
    print(f"  [spec] 複製模型 → {MODEL_DST}")
    MODEL_DST.parent.mkdir(parents=True, exist_ok=True)
    if MODEL_DST.exists():
        shutil.rmtree(MODEL_DST)
    shutil.copytree(MODEL_SRC, MODEL_DST)
else:
    print(f"  [spec] ★ 找不到模型 {MODEL_SRC}，成品會缺少模型")