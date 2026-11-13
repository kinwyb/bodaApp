/**
 * 下行事件：审批请求（approval）。
 *
 * 后端带上 approval.id（回传用的请求标识）、说明内容与可选的结构化 extra
 * （命令 / 工作目录 / 理由）。实时到达的审批一律是 pending：agent 这一轮正被它
 * 阻塞，等用户点「允许 / 拒绝」后经 chat.approval 回传。历史回放里的审批会在
 * frames.ts 里被置为 expired（那一轮早已结束，再点没有意义）。
 */

import type { AgentApprovalExtra } from '../../types';
import type { AgentEventHandler } from '../events';
import { AGENT_EVENT } from '../envelope';

/** 从后端透传的 extra 里取出已知字段，未知字段忽略 */
function approvalExtraOf(extra: Record<string, unknown> | undefined): AgentApprovalExtra | undefined {
  if (!extra) return undefined;
  const command = Array.isArray(extra.command)
    ? extra.command.map((part) => String(part))
    : undefined;
  const cwd = typeof extra.cwd === 'string' ? extra.cwd : undefined;
  const reason = typeof extra.reason === 'string' ? extra.reason : undefined;
  const method = typeof extra.method === 'string' ? extra.method : undefined;
  if (!command && !cwd && !reason && !method) return undefined;
  return { command, cwd, reason, method };
}

export const mapApprovalEvent: AgentEventHandler = (name, data, conversationId) => {
  if (name !== AGENT_EVENT.approval) return undefined;

  const approval = data.approval;
  if (!approval?.id) return [];

  return [
    {
      type: 'approval',
      conversationId,
      approval: {
        id: approval.id,
        content: approval.content ?? '',
        status: 'pending',
        extra: approvalExtraOf(approval.extra),
      },
    },
  ];
};
