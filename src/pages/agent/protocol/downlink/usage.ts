/**
 * 下行事件：token 用量（kind=agent / type=token_usage）。
 *
 * 后端每完成一次模型调用就推一帧，`data.usage` 里同时给「对话累计」（total）、
 * 「本次调用消耗」（last）与模型上下文窗口（modelContextWindow）。
 *
 * 这一帧是**覆盖**语义：delta 恒为 false、content 恒为空，
 * 绝不能当正文拼进气泡（`chat/frames.ts` 也只关心思考/工具/正文，不重放用量帧）。
 *
 * 刷新页面后没有实时帧，累计值改由 `session.list` / `session.history` 的 usage 提供
 * （见 session-list.ts 与 types.AgentHistoryThread），所以这里只管实时那一路。
 */

import { toNumberOrZero } from '@/utils';
import type { AgentTokenDetail, AgentTokenUsage } from '../../types';
import { isEmptyTokenDetail } from '../../types';
import type { AgentEventHandler } from '../events';
import type { TokenDetailData, TokenUsageData } from '../payloads';
import { AGENT_EVENT } from '../envelope';

/** 一份明细：字段缺失一律补 0，界面层不必再判空 */
function detailOf(raw: TokenDetailData | undefined): AgentTokenDetail {
  return {
    totalTokens: toNumberOrZero(raw?.totalTokens),
    inputTokens: toNumberOrZero(raw?.inputTokens),
    cachedInputTokens: toNumberOrZero(raw?.cachedInputTokens),
    cacheWriteInputTokens: toNumberOrZero(raw?.cacheWriteInputTokens),
    outputTokens: toNumberOrZero(raw?.outputTokens),
    reasoningOutputTokens: toNumberOrZero(raw?.reasoningOutputTokens),
  };
}

/**
 * 协议用量 → 领域用量。
 *
 * 三层字段都为空（老数据是 `{}`）时返回 undefined：界面据此不显示用量，
 * 而不是挂一条「0 tokens」。
 */
export function toTokenUsage(raw: TokenUsageData | null | undefined): AgentTokenUsage | undefined {
  if (!raw) return undefined;

  const total = detailOf(raw.total);
  const last = detailOf(raw.last);
  const contextWindow = toNumberOrZero(raw.modelContextWindow);

  if (isEmptyTokenDetail(total) && isEmptyTokenDetail(last) && contextWindow === 0) return undefined;
  return { total, last, contextWindow };
}

export const mapUsageEvent: AgentEventHandler = (name, data, conversationId) => {
  if (name !== AGENT_EVENT.tokenUsage) return undefined;

  const usage = toTokenUsage(data.usage);
  // 用量为空也返回空数组：这一帧属于本 handler，不该继续落到「未知事件」
  return usage ? [{ type: 'usage', conversationId, usage }] : [];
};
