/**
 * 状态层辅助函数（全部纯函数）。
 *
 * 关键约定：后端事件只带 sessionID，不带前端的消息 id，
 * 而同一会话同一时刻只会有一条回答在流 —— 所以「正在生成的消息」按状态定位，
 * 比维护 reqID → messageId 的映射更稳。
 */

import type { AgentAssistantContent, AgentConversation, AgentSegment } from '../types';
import { assistantContentOf } from '../types';
import type { AgentChatState } from './actions';

/** 修改某个会话；没命中就原样返回，避免无意义的重渲染 */
export function withConversation(
  state: AgentChatState,
  key: string,
  updater: (conversation: AgentConversation) => AgentConversation,
): AgentChatState {
  let changed = false;
  const conversations = state.conversations.map((conversation) => {
    if (conversation.key !== key) return conversation;
    const next = updater(conversation);
    if (next !== conversation) changed = true;
    return next;
  });
  return changed ? { ...state, conversations } : state;
}

/** 找到「正在生成的那条助手消息」并更新它 */
export function mapStreamingReply(
  conversation: AgentConversation,
  updater: (content: AgentAssistantContent) => AgentAssistantContent,
): AgentConversation {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role !== 'assistant' || message.status !== 'streaming') continue;
    const messages = [...conversation.messages];
    messages[index] = { ...message, content: updater(assistantContentOf(message)) };
    return { ...conversation, messages, updatedAt: Date.now() };
  }
  return conversation;
}

/**
 * 按上游实体（eventID）归并一段文本。
 *
 * 一轮对话里 codex 可能产出多个 message / reasoning item，每个 item 是一个段落，
 * 且同一 item 的 start / delta / completed 共享同一个 eventID：
 * - **同一 eventID** → 只更新自己那一段（replace 全量覆盖 / 增量追加）
 * - **换 eventID** → 新起一段
 *
 * 用「段列表」而不是「一整串文本」，是为了让某一段的 completed 全量覆盖
 * 只影响那一段，不会把前面的段落一起盖掉。
 */
export function upsertSegment(
  segments: AgentSegment[] | undefined,
  eventId: string | undefined,
  text: string,
  replace: boolean,
): AgentSegment[] {
  const list = segments ? [...segments] : [];
  const last = list[list.length - 1];
  // 没给 eventID 时（审批等）归到当前段，保持旧行为
  const sameSegment = Boolean(last) && (!eventId || last.id === eventId);

  if (last && sameSegment) {
    list[list.length - 1] = {
      id: last.id ?? eventId,
      text: replace ? text : last.text + text,
    };
    return list;
  }

  list.push({ id: eventId, text });
  return list;
}

/** 段落合成可渲染文本：段与段之间空一行 */
export function joinSegments(segments: AgentSegment[] | undefined): string {
  if (!segments || segments.length === 0) return '';
  return segments
    .map((segment) => segment.text)
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/** 把流式中的助手消息置为某个终态 */
export function finishStreamingReply(
  conversation: AgentConversation,
  status: 'done' | 'aborted' | 'error',
  fallbackText?: string,
): AgentConversation {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role !== 'assistant' || message.status !== 'streaming') continue;

    const content = assistantContentOf(message);
    const text =
      content.text ||
      (status === 'error' ? (fallbackText ?? '生成失败') : status === 'aborted' ? '已停止生成。' : '');

    const messages = [...conversation.messages];
    messages[index] = { ...message, status, content: { ...content, text } };
    return { ...conversation, messages, updatedAt: Date.now() };
  }
  return conversation;
}
