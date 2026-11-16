/**
 * 下行事件：挂起请求已落定（request_resolved）。
 *
 * 上游对审批 / 结构化提问在「已作答、超时自动落空、turn 中断」时都会发这条通知，
 * 请求 ID 放在信封 eventID 里。状态层据此把仍是 pending 的交互卡片置为 expired，
 * 避免用户向已失效的请求回包。
 */

import type { AgentEventHandler } from '../events';
import { AGENT_EVENT } from '../envelope';

export const mapRequestResolvedEvent: AgentEventHandler = (name, _data, conversationId, envelope) => {
  if (name !== AGENT_EVENT.requestResolved) return undefined;
  const requestId = envelope.eventID;
  if (!requestId) return [];
  return [{ type: 'request-resolved', conversationId, requestId }];
};
