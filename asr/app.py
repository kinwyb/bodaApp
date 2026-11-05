"""
SenseVoice-Small 语音识别服务。

音频进、文本出。识别之后的**术语纠错与格式规整**在 postprocess.py，
词表是独立的数据文件 `business_terms.txt` —— 纠错能力靠维护词表扩展，
不需要改代码，也不需要把某一句的错误写进正则。

选 SenseVoice 而不是 Whisper 的原因：
- 中文 CER 更低，且自带 ITN（"三幺六幺八零零零幺" → 316180001），正是我们最痛的物料号；
- 234M 参数 / 230MB int8 模型，CPU 就能跑，不需要 GPU；
- auto 语言检测对中英混说（bom、FT 这类）比单语模型稳。

模型从 MODEL_DIR 读（容器里挂卷，不进镜像）；音频交给 ffmpeg 解码，
所以前端 MediaRecorder 出来的 webm/opus 可以直接丢进来，不必先转 wav。
"""

import logging
import os
import subprocess
import time

import numpy as np
import sherpa_onnx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from postprocess import load_terms, postprocess

MODEL_DIR = os.environ.get("MODEL_DIR", "/models/sensevoice")
NUM_THREADS = int(os.environ.get("NUM_THREADS", "2"))
LANGUAGE = os.environ.get("LANGUAGE", "auto")
# ITN（口语数字 → 阿拉伯数字）是识别器初始化参数，请求级改不了，所以走环境变量
USE_ITN = os.environ.get("USE_ITN", "1") != "0"
SAMPLE_RATE = 16000
# 业务词表：默认跟代码放一起，也可以用 TERMS_FILE 指到别处（方便挂载热更新）
TERMS_FILE = os.environ.get(
    "TERMS_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "business_terms.txt")
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("asr")

app = FastAPI(title="SenseVoice ASR", version="1.0.0")

# 内网自用，全放开：前端直连时不会有预检失败
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_recognizer = None
_load_error: str | None = None

# 业务词表在模块加载时读一次：词表只有几十条，没必要懒加载；
# 改完词表重启容器（docker compose restart asr）即可生效，不用重建镜像。
_terms = load_terms(TERMS_FILE)
log.info("业务词表 %d 条：%s", len(_terms), TERMS_FILE)


def get_recognizer():
    """懒加载：启动时探一次，失败也不让容器挂掉，/health 会如实报原因"""
    global _recognizer, _load_error
    if _recognizer is not None:
        return _recognizer

    model = os.path.join(MODEL_DIR, "model.int8.onnx")
    tokens = os.path.join(MODEL_DIR, "tokens.txt")
    missing = [p for p in (model, tokens) if not os.path.exists(p)]
    if missing:
        _load_error = f"模型文件缺失：{', '.join(missing)}"
        raise RuntimeError(_load_error)

    started = time.time()
    _recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=model,
        tokens=tokens,
        num_threads=NUM_THREADS,
        use_itn=USE_ITN,
        language=LANGUAGE,
        debug=False,
    )
    _load_error = None
    log.info("模型加载完成，耗时 %.2fs", time.time() - started)
    return _recognizer


@app.on_event("startup")
def warm_up():
    try:
        get_recognizer()
    except Exception as error:  # noqa: BLE001 - 起不来也要能进容器看日志
        log.error("模型加载失败：%s", error)


def decode_audio(data: bytes) -> np.ndarray:
    """任意格式 → 16k 单声道 float32，统一交给 ffmpeg"""
    if not data:
        raise HTTPException(status_code=400, detail="音频为空")

    process = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-ar", str(SAMPLE_RATE), "-ac", "1",
            "-f", "s16le", "pipe:1",
        ],
        input=data,
        capture_output=True,
        check=False,
    )
    if process.returncode != 0:
        detail = process.stderr.decode("utf-8", "ignore").strip()[-300:]
        raise HTTPException(status_code=400, detail=f"音频解码失败：{detail or '未知格式'}")

    samples = np.frombuffer(process.stdout, dtype=np.int16)
    if samples.size == 0:
        raise HTTPException(status_code=400, detail="音频解码后为空")
    return samples.astype(np.float32) / 32768.0


@app.get("/health")
def health():
    return {
        "status": "ok" if _recognizer is not None else "loading",
        "model": "sensevoice-small-int8",
        "language": LANGUAGE,
        "error": _load_error,
    }


@app.post("/asr")
async def asr(file: UploadFile = File(...)):
    """
    multipart 上传音频，返回识别文本。

    `text` 是纠错后的结果（用来直接填输入框），`raw` 是识别原文（排查用）；
    数字归一化（ITN）由环境变量 USE_ITN 控制，默认开 —— 物料号靠它。
    """
    try:
        recognizer = get_recognizer()
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(error)) from error

    payload = await file.read()
    samples = decode_audio(payload)
    duration = len(samples) / SAMPLE_RATE

    started = time.time()
    stream = recognizer.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    recognizer.decode_stream(stream)
    elapsed = time.time() - started

    raw_text = stream.result.text.strip()
    text = postprocess(raw_text, _terms)
    log.info(
        "识别完成 %.2fs 音频 / %.2fs 推理 / rtf=%.3f / 纠错 %s",
        duration,
        elapsed,
        elapsed / max(duration, 1e-6),
        "有" if text != raw_text else "无",
    )

    return {
        "text": text,
        "raw": raw_text,
        "duration": round(duration, 2),
        "elapsed": round(elapsed, 3),
        "rtf": round(elapsed / max(duration, 1e-6), 3),
    }


@app.get("/terms")
def terms():
    """当前生效的业务词表（改完 business_terms.txt 重启容器即可看到）"""
    return {"count": len(_terms), "terms": [canonical for canonical, _ in _terms]}
