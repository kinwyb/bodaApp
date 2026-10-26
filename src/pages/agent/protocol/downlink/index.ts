/**
 * 下行事件路由（kind=agent）。
 *
 * 顺序即优先级：每个 handler 判断「是不是我的事件」，返回 undefined 表示不管。
 * 未知事件按协议要求静默忽略，方便服务端平滑扩展。
 *
 * 新增一类事件时：
 * 1. 在同目录加一个 `xxx.ts`，导出 `mapXxxEvent: AgentEventHandler`；
 * 2. 加进下面的 handlers 数组；
 * 3. 在 AGENT_EVENT 里登记事件名。
 */

import type { AgentEnvelope } from '../envelope';
import type { AgentEventData } from '../payloads';
import type { AgentEventHandler, AgentStreamEvent } from '../events';
import { mapApprovalEvent } from './approval';
import { mapLifecycleEvent } from './lifecycle';
import { mapMessageEvent } from './message';
import { mapReasoningEvent } from './reasoning';
import { mapToolEvent } from './tool';

const handlers: AgentEventHandler[] = [
  mapMessageEvent,
  mapReasoningEvent,
  mapToolEvent,
  mapApprovalEvent,
  mapLifecycleEvent,
];

export function mapAgentEnvelope(
  envelope: AgentEnvelope,
  conversationId: string,
): AgentStreamEvent[] {
  const data = (envelope.data ?? {}) as AgentEventData;
  const name = data.event || envelope.type;

  for (const handler of handlers) {
    // 把信封一起传下去：正文/思考要靠 envelope.eventID 归并同一实体的多次更新
    const events = handler(name, data, conversationId, envelope);
    if (events) return events;
  }
  return [];
}

export { mapEnvelopeAttachments, readSources } from './attachments';
export { toHistoryEvent, toReplayEvent } from './history';
export { parseSessionList } from './session-list';
export type { AgentSessionPage } from './session-list';
export type { HistoryMode } from './history';
export { toToolStep } from './tool';
export { parseAck, parseError, parseHello, parsePong } from './system';
export type { HelloInfo } from './system';
