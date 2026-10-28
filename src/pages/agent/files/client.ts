/**
 * 文件收发（HTTP）：上行附件上传、下行附件下载/预览。
 *
 * 为什么不走 WebSocket：ws 单帧上限 1MB（protocol.MaxMessageSize），
 * base64 还要膨胀 4/3，稍大的附件就撞墙；而且帧内传输没法断点续传、
 * 也没法直接交给浏览器渲染。所以字节走 HTTP，ws 帧里只传 fileID
 * （chat.send{fileIDs}，见 protocol/uplink/chat-send.ts）。
 *
 * 端点（对齐 buibuiCodex/core/ws/server/files.go）：
 *
 *	POST   {base}        multipart，字段名 file，响应 {items:[FileInfo]}
 *	GET    {base}        当前用户名下未过期的文件
 *	GET    {base}/<id>   内容（默认内联，?download=1 另存，?meta=1 只给元信息）
 *	DELETE {base}/<id>
 *
 * 鉴权与服务端一致：能设头的请求用 `Authorization: Bearer <token>`，
 * 直接交给浏览器的地址（img src / a href）只能走 `?token=`。
 */

import { resolveAgentToken } from '../transport';
import type { FileErrorData, FileInfoData, FileListData } from '../protocol';

/**
 * 单文件默认上限，与服务端 config.DefaultMaxUploadSize 一致（50MB）。
 *
 * 前端先拦一道只是为了省一次大文件上传；真正说了算的是服务端 ——
 * 它按自己配置的上限返回 413（file_too_large），这里照单显示即可。
 */
export const MAX_AGENT_UPLOAD_SIZE = 50 << 20;

/** 文件端点的错误：code 取自服务端 ErrorBody.code（网络/取消是自己造的） */
export class AgentFileError extends Error {
  readonly code: string;

  constructor(message: string, code = 'internal') {
    super(message);
    this.name = 'AgentFileError';
    this.code = code;
  }
}

/** 去掉末尾斜杠：base 后面统一自己拼 `/` */
function trimEndSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * 文件端点的基础地址。
 *
 * 取值优先级：
 * 1. `VITE_AGENT_FILES_URL` —— 显式配置，压过一切；
 * 2. 开发环境固定 `/ws/files` —— 走 dev server 代理（同源，绕开 CORS 与预检）。
 *    **不能只依赖 .env.development**：那个文件是 gitignore 的，别人拉下来没有这一行，
 *    就会退化成第 3 步的绝对地址、直接撞跨域。没配 ws 地址（演示模式）返回空串；
 * 3. 由 `VITE_AGENT_WS_URL` 推导 —— `ws://host:8765/ws` → `http://host:8765/ws/files`
 *    （生产没有 dev server，只能拿绝对地址，跨域由网关放行）。
 */
export function agentFilesBaseUrl(): string {
  const explicit = import.meta.env.VITE_AGENT_FILES_URL?.trim();
  if (explicit) return trimEndSlash(explicit);

  const wsUrl = import.meta.env.VITE_AGENT_WS_URL?.trim();
  if (import.meta.env.DEV) {
    // 代理规则在 vite.config.ts，target 也跟着 VITE_AGENT_WS_URL 走
    return wsUrl ? '/ws/files' : '';
  }
  if (!wsUrl) return '';
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    return `${trimEndSlash(url.origin)}${trimEndSlash(url.pathname)}/files`;
  } catch {
    // 相对地址（如 `/ws`）也能用：交给同源
    return `${trimEndSlash(wsUrl)}/files`;
  }
}

/** 从协议给的相对地址里取 fileID（`/ws/files/<id>`）；取不到返回 undefined */
function fileIdFromUrl(url: string): string | undefined {
  const match = /\/files\/([^/?#]+)/.exec(url);
  return match?.[1];
}

/**
 * 把后端给的 media.url 变成浏览器能直接用的地址。
 *
 * 服务端返回的是相对地址（它躲在反向代理后面，不知道浏览器用的 host），
 * 这里补上文件端点 base 与 `?token=`。已经是绝对地址的原样返回 ——
 * agent 可能直接把外网链接当附件发出来。
 *
 * 注意：token 出现在 URL 里是因为 `<img src>` / `<a href>` 设不了请求头；
 * 服务端本来就支持 `?token=`，风险面与 ws 连接（也是 `?token=`）相同。
 */
export function resolveAgentFileUrl(
  url?: string,
  options: { download?: boolean } = {},
): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|blob:|data:)/i.test(url)) return url;

  const id = fileIdFromUrl(url);
  const base = agentFilesBaseUrl();
  if (!id || !base) return url;

  const params = new URLSearchParams();
  const token = resolveAgentToken();
  if (token) params.set('token', token);
  if (options.download) params.set('download', '1');
  const query = params.toString();
  return `${base}/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}

function authHeaders(): Record<string, string> {
  const token = resolveAgentToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 解析错误响应：服务端给 {code,message}，解析不出来就用状态码兜底 */
function toFileError(status: number, body: string): AgentFileError {
  let payload: FileErrorData | undefined;
  try {
    payload = JSON.parse(body) as FileErrorData;
  } catch {
    payload = undefined;
  }
  if (payload?.message) {
    return new AgentFileError(payload.message, payload.code ?? `http_${status}`);
  }
  if (status === 401) return new AgentFileError('身份校验失败，请重新登录后再试', 'unauthorized');
  if (status === 403) return new AgentFileError('无权访问该文件', 'forbidden');
  if (status === 404) return new AgentFileError('文件不存在或已过期', 'file_not_found');
  if (status === 413) return new AgentFileError('文件超过服务端允许的大小', 'file_too_large');
  return new AgentFileError(`文件服务返回 ${status}`, `http_${status}`);
}

/** 从响应体里取第一个文件（上传响应固定是 {items:[...]}，一个文件也是数组） */
function firstItem(body: string): FileInfoData | undefined {
  try {
    const payload = JSON.parse(body) as FileListData;
    return payload?.items?.[0];
  } catch {
    return undefined;
  }
}

export type UploadOptions = {
  /** 上传进度 0-100 */
  onProgress?: (percent: number) => void;
  /** 取消上传（用户移除附件时） */
  signal?: AbortSignal;
};

/**
 * 上传一个文件，返回它在新会话里的身份。
 *
 * 用 XHR 而不是 fetch：fetch 到现在也没有上传进度事件，
 * 而附件常常是几十 MB，没有进度条用户会以为卡死。
 */
export function uploadAgentFile(file: File, options: UploadOptions = {}): Promise<FileInfoData> {
  if (file.size > MAX_AGENT_UPLOAD_SIZE) {
    return Promise.reject(
      new AgentFileError(
        `文件超过 ${Math.round(MAX_AGENT_UPLOAD_SIZE / (1 << 20))}MB 上限`,
        'file_too_large',
      ),
    );
  }

  const base = agentFilesBaseUrl();
  if (!base) {
    return Promise.reject(new AgentFileError('未配置文件服务地址', 'unsupported'));
  }
  if (options.signal?.aborted) {
    return Promise.reject(new AgentFileError('上传已取消', 'aborted'));
  }

  const form = new FormData();
  // 字段名必须叫 file：服务端只认这个（server/files.go 的 fileFieldName）
  form.append('file', file, file.name);

  return new Promise<FileInfoData>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', base);
    const token = resolveAgentToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !options.onProgress) return;
      options.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const info = firstItem(xhr.responseText);
        if (info?.id) resolve(info);
        else reject(new AgentFileError('上传响应无法解析', 'internal'));
        return;
      }
      reject(toFileError(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => reject(new AgentFileError('网络异常，上传失败', 'network'));
    xhr.onabort = () => reject(new AgentFileError('上传已取消', 'aborted'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(form);
  });
}

/** 删除一个已上传的文件（移除附件、放弃发送时回收，免得占着磁盘到过期） */
export async function deleteAgentFile(id: string): Promise<void> {
  const base = agentFilesBaseUrl();
  if (!base || !id) return;
  const response = await fetch(`${base}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  // 已经过期/被回收都算删除成功，只有真正的失败才抛
  if (!response.ok && response.status !== 404) {
    throw toFileError(response.status, await response.text());
  }
}

/** 列出当前用户名下仍有效的文件（排查用；界面上暂未提供入口） */
export async function listAgentFiles(): Promise<FileInfoData[]> {
  const base = agentFilesBaseUrl();
  if (!base) return [];
  const response = await fetch(base, { headers: authHeaders() });
  if (!response.ok) throw toFileError(response.status, await response.text());
  const payload = (await response.json()) as FileListData;
  return payload?.items ?? [];
}

/** 统一取错误文案：非 AgentFileError 也给出可读的兜底 */
export function fileErrorMessage(error: unknown): string {
  if (error instanceof AgentFileError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '上传失败，请重试';
}
