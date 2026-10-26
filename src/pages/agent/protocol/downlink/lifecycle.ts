/**
 * 下行事件：生命周期与错误。
 *
 * - error：这一轮失败（data.error.message 或 data.content）
 * - finished：一轮结束，界面据此把「正在生成」收尾
 * - user_message_start / user_message_completed：用户消息由前端自己插入，忽略即可
 */

import type { AgentEventHandler } from '../events';
import { AGENT_EVENT } from '../envelope';

export const mapLifecycleEvent: AgentEventHandler = (name, data, conversationId) => {
  switch (name) {
    case AGENT_EVENT.error:
      return [
        {
          type: 'error',
          conversationId,
          message: data.error?.message || data.content || 'Agent 执行失败',
        },
      ];

    case AGENT_EVENT.finished:
      return [{ type: 'reply-done', conversationId }];

    case AGENT_EVENT.userMessageStart:
    case AGENT_EVENT.userMessageCompleted:
      return [];

    default:
      return undefined;
  }
};
