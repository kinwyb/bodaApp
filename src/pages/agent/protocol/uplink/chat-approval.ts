/**
 * 上行命令：chat.approval（回传审批决定）。
 *
 * agent 执行到需要授权的操作（命令 / 文件变更）时会下发 approval 帧并阻塞这一轮，
 * 用户点「允许 / 拒绝」后用它把决定送回去。approvalID 就是下行 approval.id。
 * 服务端优先用 sessionID，没有就用 chatID 自己推导（command.SessionKey）。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { ApprovalDecisionData, ChatApprovalData } from '../payloads';

export type ChatApprovalInput = {
  chatID?: string;
  sessionID?: string;
  approvalID: string;
  decision: ApprovalDecisionData;
};

export function buildChatApproval(input: ChatApprovalInput): AgentEnvelope {
  const data: ChatApprovalData = {
    sessionID: input.sessionID || undefined,
    chatID: input.chatID || undefined,
    approvalID: input.approvalID,
    decision: input.decision,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.chatApproval, data });
}
