/**
 * 下行事件：正文（message_start / message_delta / message_completed）。
 *
 * 同一个 codex agentMessage item 的 start / delta / completed 共享 `envelope.eventID`，
 * 换 id 就说明是同一轮里的另一段正文 —— 前端据此分段，不靠 start 的到达顺序。
 *
 * - start 可能带首段内容，带就整体替换当前段
 * - delta 的 `data.delta === false` 表示全量，替换当前段而不是追加
 * - completed 一般不带内容；带了就按全量收敛当前段
 */

import type { AgentEventHandler } from '../events';
import { AGENT_EVENT } from '../envelope';

export const mapMessageEvent: AgentEventHandler = (name, data, conversationId, envelope) => {
  const eventId = envelope.eventID;

  switch (name) {
    case AGENT_EVENT.messageStart:
      return data.content
        ? [
            { type: 'reply-start', conversationId },
            { type: 'text', conversationId, text: data.content, replace: true, eventId },
          ]
        : [{ type: 'reply-start', conversationId }];

    case AGENT_EVENT.messageDelta:
      return data.content
        ? [{ type: 'text', conversationId, text: data.content, replace: data.delta === false, eventId }]
        : [];

    case AGENT_EVENT.messageCompleted:
      return data.content
        ? [{ type: 'text', conversationId, text: data.content, replace: true, eventId }]
        : [];

    default:
      return undefined;
  }
};
