/**
 * 状态层辅助函数（全部纯函数）。
 *
 * 关键约定：后端事件只带 sessionID，不带前端的消息 id，
 * 而同一会话同一时刻只会有一条回答在流 —— 所以「正在生成的消息」按状态定位，
 * 比维护 reqID → messageId 的映射更稳。
 *
 * 片段顺序：一轮里思考/工具/正文是交错的，统一进 `timeline`，
 * 渲染严格按数组顺序走（旧的 text/reasoning/steps 只是它的派生汇总）。
 */

import type {
  AgentAssistantContent,
  AgentApproval,
  AgentConversation,
  AgentTimelineItem,
  AgentToolStep,
} from '../types';
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

let itemSeed = 0;

function nextItemKey(kind: string): string {
  itemSeed += 1;
  return `${kind}-${Date.now().toString(36)}-${itemSeed}`;
}

/**
 * 文本合并：兼容「增量片段」与「累积全量」两种上游行为。
 *
 * 后端偶尔会把 item 的累积文本当 delta 帧发出来（delta=true 但内容是全文），
 * 直接追加就会像复读机一样重复。这里用前缀/后缀关系识别：
 * - 新内容以已有内容开头 → 是累积快照，直接替换
 * - 新内容已经在结尾里 → 是重复帧，忽略
 * - 其余情况按增量追加（正常路径）
 */
export function mergeText(base: string, chunk: string, replace: boolean): string {
  if (replace) return chunk;
  if (!base) return chunk;
  if (chunk === base) return base;
  if (chunk.startsWith(base)) return chunk;
  if (base.endsWith(chunk)) return base;
  return base + chunk;
}

type TextItem = Extract<AgentTimelineItem, { kind: 'text' | 'reasoning' }>;

function isTextItem(item: AgentTimelineItem | undefined): item is TextItem {
  return Boolean(item) && (item!.kind === 'text' || item!.kind === 'reasoning');
}

/**
 * 把还没结束的思考片段一并收尾。
 *
 * 后端有时不发 `reasoning_completed`（实测某些轮次只有 start），
 * 但只要后面出现了正文 / 工具 / 新一段思考，就说明前面的思考已经结束 ——
 * 否则折叠块的转圈会一直转到整轮结束。
 */
function settleReasoning(timeline: AgentTimelineItem[]): AgentTimelineItem[] {
  return timeline.map((item) =>
    isTextItem(item) && item.kind === 'reasoning' && !item.done ? { ...item, done: true } : item,
  );
}

/**
 * 追加 / 更新一段文本。
 *
 * 同一 eventID 的 start / delta / completed 归到同一个片段，
 * 换 eventID 就新起一段 —— 片段之间因此保持后端真实的先后顺序。
 * 后续帧可能与别的片段交错到达，所以按 eventID 全表查找，而不是只看末尾。
 */
export function appendTimelineText(
  timeline: AgentTimelineItem[] | undefined,
  kind: 'text' | 'reasoning',
  eventId: string | undefined,
  text: string,
  replace: boolean,
  done = false,
): AgentTimelineItem[] {
  let list = timeline ? [...timeline] : [];

  // 同一个 eventID（没有 eventID 时退化成「同类型的最后一段」）就是同一段
  const index = eventId
    ? list.findIndex((item) => isTextItem(item) && item.kind === kind && item.eventId === eventId)
    : list.findLastIndex((item) => isTextItem(item) && item.kind === kind);

  if (index >= 0) {
    const item = list[index] as TextItem;
    // completed 帧可能不带内容（只表示「这段结束了」）：只标记结束，不动文本
    list[index] = {
      ...item,
      text: text ? mergeText(item.text, text, replace) : item.text,
      done: done || item.done,
    };
    return list;
  }

  // 走到这里说明是一个新的片段：前面还没结束的思考都算结束了
  list = settleReasoning(list);
  if (!text) return list;

  list.push({ kind, key: nextItemKey(kind), eventId, text, done });
  return list;
}

/** 工具步：同一个 ToolCall.id 后到的覆盖，新步骤按时间顺序追加到末尾 */
export function upsertTimelineTool(
  timeline: AgentTimelineItem[] | undefined,
  step: AgentToolStep,
): AgentTimelineItem[] {
  let list = timeline ? [...timeline] : [];
  const index = list.findIndex((item) => item.kind === 'tool' && item.step.key === step.key);
  if (index >= 0) {
    list[index] = { kind: 'tool', key: list[index].key, step };
    return list;
  }
  // 开始调工具 = 之前的思考结束了
  list = settleReasoning(list);
  list.push({ kind: 'tool', key: nextItemKey('tool'), step });
  return list;
}

/** 审批：同 id 覆盖，否则追加 */
export function upsertTimelineApproval(
  timeline: AgentTimelineItem[] | undefined,
  approval: AgentApproval,
): AgentTimelineItem[] {
  const list = timeline ? [...timeline] : [];
  const index = list.findIndex((item) => item.kind === 'approval' && item.approval.id === approval.id);
  if (index >= 0) {
    list[index] = { kind: 'approval', key: list[index].key, approval };
    return list;
  }
  list.push({ kind: 'approval', key: nextItemKey('approval'), approval });
  return list;
}

/** 错误：一条回答里通常只有一个，重复的覆盖 */
export function upsertTimelineError(
  timeline: AgentTimelineItem[] | undefined,
  message: string,
): AgentTimelineItem[] {
  const list = timeline ? [...timeline] : [];
  const index = list.findIndex((item) => item.kind === 'error');
  if (index >= 0) {
    list[index] = { kind: 'error', key: list[index].key, message };
    return list;
  }
  list.push({ kind: 'error', key: nextItemKey('error'), message });
  return list;
}

/** 收尾：所有还没标记完成的文本片段置为 done（思考的转圈据此停下） */
export function completeTimeline(timeline: AgentTimelineItem[] | undefined): AgentTimelineItem[] {
  if (!timeline || timeline.length === 0) return [];
  return timeline.map((item) =>
    isTextItem(item) && !item.done ? { ...item, done: true } : item,
  );
}

/** 由时间线重算汇总字段（正文/思考/工具列表） */
export function summarizeTimeline(
  timeline: AgentTimelineItem[],
): Pick<AgentAssistantContent, 'text' | 'reasoning' | 'steps'> {
  const texts: string[] = [];
  const reasonings: string[] = [];
  const steps: AgentToolStep[] = [];

  timeline.forEach((item) => {
    if (item.kind === 'text') texts.push(item.text);
    else if (item.kind === 'reasoning') reasonings.push(item.text);
    else if (item.kind === 'tool') steps.push(item.step);
  });

  return {
    text: texts.filter(Boolean).join('\n\n'),
    reasoning: reasonings.filter(Boolean).join('\n\n') || undefined,
    steps: steps.length > 0 ? steps : undefined,
  };
}

/** 以「时间线为准」整理内容：timeline 是渲染真源，其余字段由它派生 */
export function withTimeline(
  content: AgentAssistantContent,
  timeline: AgentTimelineItem[],
): AgentAssistantContent {
  return { ...content, timeline, ...summarizeTimeline(timeline) };
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
    const timeline = completeTimeline(content.timeline);
    const text =
      content.text ||
      (status === 'error' ? (fallbackText ?? '生成失败') : status === 'aborted' ? '已停止生成。' : '');

    const messages = [...conversation.messages];
    messages[index] = { ...message, status, content: { ...withTimeline(content, timeline), text } };
    return { ...conversation, messages, updatedAt: Date.now() };
  }
  return conversation;
}
