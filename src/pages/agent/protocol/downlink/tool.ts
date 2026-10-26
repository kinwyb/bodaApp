/**
 * 下行事件：工具调用（tool_start / tool_completed）。
 *
 * 一次事件可能带多个 toolCalls，逐个映射成界面上的「一步」；
 * 步骤 key 用 ToolCall.id，start 与 completed 靠它配对更新同一步。
 */

import type { AgentEventHandler, AgentStreamEvent } from '../events';
import { AGENT_EVENT, clip } from '../envelope';
import type { AgentToolCall } from '../payloads';
import type { AgentStepStatus, AgentToolStep } from '../../types';

/** types.ToolCall → 界面步骤 */
export function toToolStep(
  call: AgentToolCall,
  status: AgentStepStatus,
  fallbackIndex: number,
): AgentToolStep {
  // 工具执行失败的约定：extra.status === 'error' 或 extra.success === false
  const failed = call.extra?.status === 'error' || call.extra?.success === false;
  return {
    key: call.id || `tool-${call.name ?? 'call'}-${fallbackIndex}`,
    title: call.name || '工具调用',
    description: clip(call.params, 160),
    content: call.result || undefined,
    status: failed ? 'error' : status,
  };
}

export const mapToolEvent: AgentEventHandler = (name, data, conversationId) => {
  if (name !== AGENT_EVENT.toolStart && name !== AGENT_EVENT.toolCompleted) return undefined;

  const calls = data.toolCalls ?? [];
  if (calls.length === 0) return [];

  const status: AgentStepStatus = name === AGENT_EVENT.toolStart ? 'loading' : 'success';
  return calls.map(
    (call, index): AgentStreamEvent => ({
      type: 'tool',
      conversationId,
      step: toToolStep(call, status, index),
    }),
  );
};
