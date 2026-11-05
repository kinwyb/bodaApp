/**
 * 语音识别（ASR）客户端。
 *
 * 服务本身在仓库 `asr/` 目录：SenseVoice-Small + Docker，默认监听 127.0.0.1:9383。
 * 这里**不走 `@/api`**：那套封装处理 JSON + 统一鉴权，而录音是 multipart 二进制，
 * 识别服务又是独立进程、不需要登录态。
 *
 * 地址策略与附件上传一致：开发环境用同源的 `/asr`（vite.config.ts 里代理到 9383，
 * 绕开 CORS 预检）；生产用 `VITE_ASR_URL` 指向实际服务地址。
 */

const FALLBACK_PATH = '/asr';

function resolveEndpoint(): string {
  const explicit = import.meta.env.VITE_ASR_URL?.trim();
  if (!explicit) return FALLBACK_PATH;
  return `${explicit.replace(/\/+$/, '')}/asr`;
}

const ENDPOINT = resolveEndpoint();

/** 默认超时：15 秒音频在 2 核容器里约 0.3 秒，给足余量即可；卡住多半是服务没起 */
const DEFAULT_TIMEOUT_MS = 15_000;

type AsrResponse = {
  text?: string;
  duration?: number;
  elapsed?: number;
};

/**
 * 上传一段录音，返回识别文本（识别不出内容时是空串）。
 *
 * `blob` 的格式不用管：服务端交给 ffmpeg 解码，webm/opus、mp4、wav 都能吃。
 */
export async function transcribeVoice(
  blob: Blob,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const form = new FormData();
  // 文件名只用于服务端日志；扩展名按真实类型给，方便排查
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('wav') ? 'wav' : 'webm';
  form.append('file', blob, `voice.${ext}`);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      // 服务端 503 = 模型还没加载完；400 = 音频解不开。detail 里带原因
      const detail = await response
        .json()
        .then((body: { detail?: string }) => body?.detail)
        .catch(() => undefined);
      throw new Error(detail || `识别服务返回 ${response.status}`);
    }

    const data = (await response.json()) as AsrResponse;
    return (data.text ?? '').trim();
  } finally {
    window.clearTimeout(timeout);
  }
}

/** 把各种异常翻译成用户看得懂的一句话 */
export function voiceErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '语音识别超时，服务可能没启动（cd asr && docker compose up -d）';
  }
  if (error instanceof TypeError) {
    // fetch 抛 TypeError 基本就是连不上
    return '连不上语音识别服务（localhost:9383），先启动 asr 容器';
  }
  if (error instanceof Error && error.message) return error.message;
  return '语音识别失败，请重试';
}
