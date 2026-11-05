# SenseVoice-Small 语音识别（CPU 即可，不需要 GPU）
#
# 模型不进镜像：230MB 权重挂在 /models 上，`docker rm` 之后不用重下。
# 镜像里装 ffmpeg 是为了让前端 MediaRecorder 直接传 webm/opus，省掉一次前端转码。
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_DIR=/models/sensevoice \
    NUM_THREADS=2 \
    LANGUAGE=auto \
    USE_ITN=1

# 只装 ffmpeg：让前端能直接传 webm/opus，省掉一次前端转码。
# 注意：ffmpeg 在 arm64 上会带一串 X11/llvm 依赖（约 97MB），国内直连 deb.debian.org
# 会卡到超时（实测 205kB/s，libllvm19 直接拉失败），需要 Docker 走代理再构建。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 默认走官方源（Docker 需能出网）；内网无代理时用 --build-arg 指到国内镜像
ARG PIP_INDEX_URL=https://pypi.org/simple

COPY requirements.txt ./
RUN pip install --no-cache-dir -i ${PIP_INDEX_URL} -r requirements.txt

COPY app.py postprocess.py business_terms.txt ./

EXPOSE 9383

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:9383/health', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9383"]
