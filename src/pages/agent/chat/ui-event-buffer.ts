import type { UIEventNotice } from '../protocol';
import type { UIEventDefinition } from '../ui-bridge/types';
import type { AgentToolStep } from '../types';

/** 合并后的普通事件达到这个数量才允许主动发送 */
export const UI_EVENT_BATCH_THRESHOLD = 12;
/** 缓冲区硬上限，避免页面事件异常高频时无限增长 */
export const UI_EVENT_BUFFER_LIMIT = 32;

export type BufferedUIEvent = {
  notice: UIEventNotice;
  mergeBy: string[];
};

function mergeKey(item: BufferedUIEvent): string {
  const identity = item.mergeBy.map((field) => item.notice.payload?.[field]);
  return JSON.stringify([item.notice.view, item.notice.event, ...identity]);
}

/**
 * 相同事件 + mergeBy 只保留最后一次，并移到最新位置。
 *
 * 计数发生在合并之后，所以连续选中 10 行不会被当成 10 个待发送事件。
 */
export function mergeUIEvent(
  buffer: BufferedUIEvent[],
  notice: UIEventNotice,
  definition: UIEventDefinition,
): BufferedUIEvent[] {
  const item: BufferedUIEvent = { notice, mergeBy: definition.mergeBy ?? [] };
  const key = mergeKey(item);
  const rest = buffer.filter((current) => mergeKey(current) !== key);
  rest.push(item);
  return rest.slice(-UI_EVENT_BUFFER_LIMIT);
}

/** 历史帧缺失时，从 turn.question 的事件块补一个工具步骤 */
export function uiEventStepOf(
  events: UIEventNotice[],
  key: string,
): AgentToolStep {
  return {
    key,
    title: '界面事件批次',
    origin: 'ui-event',
    description: JSON.stringify({ v: 1, events }),
    status: 'success',
  };
}
