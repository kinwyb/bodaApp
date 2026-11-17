/**
 * 下行事件：一条信封上附带的媒体与引用。
 *
 * 后端把 media 放在 data.media，引用（如果 agent 塞了）放在 data.meta.sources，
 * 与正文事件同帧到达，这里单独抽成事件，界面分别用 FileCard.List / Sources 渲染。
 */

import type { AgentStreamEvent } from '../events';
import type { AgentEnvelope } from '../envelope';
import type { AgentEventData, AgentToolCall } from '../payloads';
import type { AgentMedia, AgentSource } from '../../types';

/** meta.sources 宽松解析：字段不全的条目直接跳过 */
export function readSources(meta: Record<string, unknown> | undefined): AgentSource[] {
  const raw = meta?.sources;
  if (!Array.isArray(raw)) return [];

  const result: AgentSource[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const title =
      typeof record.title === 'string'
        ? record.title
        : typeof record.name === 'string'
          ? record.name
          : '';
    if (!title) return;
    result.push({
      key: typeof record.key === 'string' ? record.key : String(index),
      title,
      url: typeof record.url === 'string' ? record.url : undefined,
      description: typeof record.description === 'string' ? record.description : undefined,
    });
  });
  return result;
}

/**
 * 归一化一条 media。
 *
 * 后端的文件名 / 大小 / fileID 都放在 metadata 里（types.Media 本身没有 name 字段），
 * 直接渲染会导致「文件名变成一串 fileID」。这里提到顶层字段：
 * - name：优先 metadata.filename，退回落 url 末段；
 * - size：metadata.size；
 * - fileId：metadata.fileID（删除、查元信息时用）。
 */
export function normalizeMedia(media: AgentMedia): AgentMedia {
  const meta = media.metadata ?? {};
  const filename = typeof meta.filename === 'string' ? meta.filename.trim() : '';
  const size = typeof meta.size === 'number' ? meta.size : undefined;
  const fileId = typeof meta.fileID === 'string' ? meta.fileID : undefined;
  return {
    ...media,
    name: media.name || filename || undefined,
    size,
    fileId,
  };
}

export function mapEnvelopeAttachments(
  envelope: AgentEnvelope,
  conversationId: string,
): AgentStreamEvent[] {
  const data = (envelope.data ?? {}) as AgentEventData;
  const events: AgentStreamEvent[] = [];

  if (data.media && data.media.length > 0) {
    events.push({
      type: 'media',
      conversationId,
      media: data.media.map((media) => normalizeMedia(media)),
    });
  }

  const sources = readSources(data.meta);
  if (sources.length > 0) {
    events.push({ type: 'sources', conversationId, sources });
  }

  return events;
}

/** agent 发送文件给用户的工具名（core/tools.go 的 SendFileTool） */
export const SEND_FILE_TOOL = 'send_file';

/** 从路径取文件名：去掉 query/hash，兼容 / 与 \ 分隔 */
function baseNameOf(path: string): string {
  const clean = path.split(/[?#]/)[0];
  return (clean.split(/[/\\]/).pop() ?? '').trim();
}

/** 按扩展名推断 image / file，对齐后端 detectFileType 的常见图片后缀 */
function mediaTypeOfName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'bmp':
    case 'webp':
    case 'svg':
    case 'ico':
    case 'heic':
      return 'image';
    default:
      return 'file';
  }
}

/**
 * 把一次成功的 send_file 工具调用还原成一条 media（文件卡片）。
 *
 * 历史帧不落库附件的 fileID / 下载地址（文件是瞬时产物，回放时多半已过期），
 * 但入参里的 file_path 还在：用它补出文件名与类型，让历史里也能看到
 * 「agent 发过哪个文件」，而不是过程链里的一条 send_file 工具记录。
 * 没有可访问地址，卡片只读展示、不可点开。
 *
 * 非 send_file、或执行失败（extra.status === 'error' / success === false）返回
 * undefined —— 失败的调用仍按工具步骤展示，便于用户看到错误。
 */
export function sendFileMediaOf(call: AgentToolCall): AgentMedia | undefined {
  if (call.name !== SEND_FILE_TOOL) return undefined;
  if (call.extra?.status === 'error' || call.extra?.success === false) return undefined;

  let filePath = '';
  let caption = '';
  try {
    const params = JSON.parse(call.params ?? '{}') as {
      file_path?: unknown;
      caption?: unknown;
    };
    if (typeof params.file_path === 'string') filePath = params.file_path.trim();
    if (typeof params.caption === 'string') caption = params.caption;
  } catch {
    // params 可能被截断或不是 JSON：退回从结果文本里取文件名
  }

  let name = filePath ? baseNameOf(filePath) : '';
  if (!name) {
    // 结果形如「✅ 文件已发送: xxx.md」
    const match = /文件已发送[:：]\s*(.+?)\s*$/.exec(call.result ?? '');
    name = match?.[1] ?? '';
  }
  if (!name) return undefined;

  const metadata: Record<string, unknown> = { filename: name };
  if (caption) metadata.caption = caption;

  // 远程地址：本身就能打开，按普通下行附件渲染（url 直接可用）
  if (/^https?:\/\//i.test(filePath)) {
    return { type: mediaTypeOfName(name), name, url: filePath, metadata };
  }

  // 本地容器路径：没有 fileID 地址，记下 filePath，渲染层结合 agent 走工作区浏览打开
  if (filePath) metadata.filePath = filePath;
  return { type: mediaTypeOfName(name), name, metadata };
}
