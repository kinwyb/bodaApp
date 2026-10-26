/**
 * 下行事件：审批请求（approval）。
 *
 * 后端会带上 approval.id 与说明内容；目前服务端还没有审批回传的上行命令，
 * 所以界面只做展示（不提供「允许 / 拒绝」按钮，避免出现点了没反应的假交互）。
 */

import type { AgentEventHandler } from '../events';
import { AGENT_EVENT } from '../envelope';

export const mapApprovalEvent: AgentEventHandler = (name, data, conversationId) => {
  if (name !== AGENT_EVENT.approval) return undefined;

  const approval = data.approval;
  if (!approval?.id) return [];

  return [
    {
      type: 'approval',
      conversationId,
      approval: { id: approval.id, content: approval.content ?? '' },
    },
  ];
};
