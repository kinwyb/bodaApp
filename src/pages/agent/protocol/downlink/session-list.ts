/**
 * 下行：session.list 响应 → 领域结构。
 *
 * 服务端字段都可缺省（omitempty），这里统一补默认值，
 * 上层拿到的一定是排好序、字段齐全的列表。
 */

import type { AgentSessionSummary } from '../../types';
import type { SessionListResult } from '../payloads';
import { toTokenUsage } from './usage';

export type AgentSessionPage = {
  items: AgentSessionSummary[];
  hasMore: boolean;
  /** 下一页游标：原样回传即可续拉 */
  nextBeforeLastUpdate?: number;
  nextBeforeThreadID?: string;
};

export function parseSessionList(data: unknown): AgentSessionPage {
  const raw = (data ?? {}) as SessionListResult;
  const items: AgentSessionSummary[] = (raw.items ?? [])
    .map((item) => ({
      threadId: item.threadID ?? '',
      sessionId: item.sessionID ?? '',
      agent: item.agent ?? '',
      title: item.title ?? '',
      preview: item.preview ?? '',
      turns: item.turns ?? 0,
      completed: item.completed !== false,
      createdAt: item.createdAt ?? 0,
      updatedAt: item.lastUpdate ?? 0,
      // 列表只给累计（total），没有 last 与上下文窗口
      usage: toTokenUsage(item.usage),
    }))
    // 没有 threadID 的条目没法用来拉历史，直接丢掉
    .filter((item) => item.threadId);

  return {
    items,
    hasMore: raw.hasMore === true,
    nextBeforeLastUpdate: raw.nextBeforeLastUpdate ?? undefined,
    nextBeforeThreadID: raw.nextBeforeThreadID ?? undefined,
  };
}
