/**
 * 下行事件：思考过程（reasoning_start / reasoning_delta / reasoning_completed）。
 *
 * 一轮里可能有多个 reasoning item（思考 → 工具 → 再思考），
 * 它们共用 `envelope.eventID` 区分：同一个 id 是同一段思考的多次更新，
 * 换 id 就是新的一段，由状态层按顺序拼起来。
 *
 * 界面用 Think 组件折叠展示，流式时 blinking。
 */

import type { AgentEventHandler } from '../events';
import { AGENT_EVENT } from '../envelope';

export const mapReasoningEvent: AgentEventHandler = (name, data, conversationId, envelope) => {
  if (
    name !== AGENT_EVENT.reasoningStart &&
    name !== AGENT_EVENT.reasoningDelta &&
    name !== AGENT_EVENT.reasoningCompleted
  ) {
    return undefined;
  }

  const piece = data.reasoning || data.content || '';
  const done = name === AGENT_EVENT.reasoningCompleted;

  // completed 可能不带内容（只表示「想完了」）：仍然要发，状态层据此停掉转圈
  if (!piece && !done) return [];

  return [
    {
      type: 'reasoning',
      conversationId,
      text: piece,
      // start 带的是该段首段内容，completed 带的是该段全量 —— 都按「替换当前段」处理
      replace: name === AGENT_EVENT.reasoningStart || (Boolean(piece) && data.delta === false),
      eventId: envelope.eventID,
      done,
    },
  ];
};
