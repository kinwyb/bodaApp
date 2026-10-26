/**
 * 上行命令：session.history（拉取历史消息）。
 *
 * 三种用法（见 command.sessionHistory 注释）：
 * - 打开会话：只传 chatID，返回全部线程与轮次，**同时让服务端订阅该会话**（重连后能续收实时事件）
 * - 向上翻页：额外传 beforeSeq（取当前最早一条的 seq）
 * - 断线补发：额外传 since（本地最后一条的时间戳）
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { SessionHistoryData } from '../payloads';

export type SessionHistoryInput = {
  chatID?: string;
  sessionID?: string;
  threadID?: string;
  beforeSeq?: number;
  since?: number;
  limit?: number;
  /** 附带逐帧执行过程（思考 / 工具 / 审批 / 错误） */
  includeFrames?: boolean;
};

export function buildSessionHistory(input: SessionHistoryInput): AgentEnvelope {
  const data: SessionHistoryData = {
    sessionID: input.sessionID || undefined,
    chatID: input.chatID || undefined,
    threadID: input.threadID || undefined,
    beforeSeq: input.beforeSeq || undefined,
    since: input.since || undefined,
    limit: input.limit || undefined,
    includeFrames: input.includeFrames || undefined,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.sessionHistory, data });
}
