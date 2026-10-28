/**
 * 下行事件：一条信封上附带的媒体与引用。
 *
 * 后端把 media 放在 data.media，引用（如果 agent 塞了）放在 data.meta.sources，
 * 与正文事件同帧到达，这里单独抽成事件，界面分别用 FileCard.List / Sources 渲染。
 */

import type { AgentStreamEvent } from '../events';
import type { AgentEnvelope } from '../envelope';
import type { AgentEventData } from '../payloads';
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
