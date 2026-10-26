/**
 * 上行命令：session.turn.replay（回放单轮完整执行过程）。
 *
 * 与 session.history 的分工：
 * - history 用 includeFrames 拿「列表级」的过程，服务端有帧数/体积上限（会被截断）；
 * - replay 拿「某一轮」的完整过程：不限帧数、不截断内容，用于用户点开细看。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { TurnReplayData } from '../payloads';

export type TurnReplayInput = {
  chatID?: string;
  sessionID?: string;
  /** 轮次标识，必填 */
  turnID: string;
  /** 只取 seq 大于该值的事件（续拉） */
  afterSeq?: number;
  limit?: number;
};

export function buildTurnReplay(input: TurnReplayInput): AgentEnvelope {
  const data: TurnReplayData = {
    sessionID: input.sessionID || undefined,
    chatID: input.chatID || undefined,
    turnID: input.turnID,
    afterSeq: input.afterSeq || undefined,
    limit: input.limit || undefined,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.turnReplay, data });
}
