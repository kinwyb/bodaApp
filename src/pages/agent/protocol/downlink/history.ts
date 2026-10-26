/**
 * 下行：历史消息（system/session.history）与单轮回放（system/session.turn.replay）。
 *
 * 两者都在 system 域，都要靠上行信封的 replyTo 找回归属会话，
 * 所以由传输层处理完 pending 后调用这里生成语义事件。
 */

import type { AgentStreamEvent } from '../events';
import type { SessionHistoryResult, TurnReplayResult } from '../payloads';

export type HistoryMode = 'replace' | 'prepend' | 'append';

export function toHistoryEvent(
  result: SessionHistoryResult,
  conversationId: string,
  mode: HistoryMode,
): AgentStreamEvent {
  return {
    type: 'history',
    conversationId,
    threads: Array.isArray(result.threads) ? result.threads : [],
    // 逐帧过程：与实时流同构，交给状态层按 reqID 归组还原
    frames: Array.isArray(result.frames) ? result.frames : [],
    framesTruncated: Boolean(result.framesTruncated),
    mode,
  };
}

export function toReplayEvent(result: TurnReplayResult, conversationId: string): AgentStreamEvent {
  return {
    type: 'replay',
    conversationId,
    turnId: result.turnID ?? '',
    frames: Array.isArray(result.frames) ? result.frames : [],
    hasMore: Boolean(result.hasMore),
    nextAfterSeq: result.nextAfterSeq,
    truncated: Boolean(result.truncated),
  };
}
