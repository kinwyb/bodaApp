/**
 * 把历史帧还原成消息（纯函数）。
 *
 * 后端 `session.history` 的 frames 与实时流同构：同一轮共享 reqID，
 * 每条帧的 `type` 就是事件名。**但回放帧一律是全量快照（delta=false）**，
 * 所以不能直接复用流式的「追加」语义，要按「start 是过程快照、completed 是终态」来取。
 *
 * 另外 frames 只还原关键帧（思考 / 消息 / 工具 / 审批 / 错误），没有 token 级 delta，
 * 因此这里不需要考虑打字机效果。
 */

import type { AgentEnvelope, AgentEventData } from '../protocol';
import { AGENT_EVENT, mapAgentEnvelope, mapEnvelopeAttachments } from '../protocol';
import type {
  AgentAssistantContent,
  AgentHistoryTurn,
  AgentMedia,
  AgentMessage,
  AgentSource,
  AgentTimelineItem,
} from '../types';
import { hasRenderableContent } from '../types';
import {
  appendTimelineText,
  upsertTimelineApproval,
  upsertTimelineError,
  upsertTimelineTool,
  withTimeline,
} from './helpers';

/** 服务端截断文本时会追加这个标记（replay.clip） */
const TRUNCATED_MARK = '（已截断';

/** 同一轮的帧共享 reqID，按它归组；没有 reqID 的帧归到上一组 */
export function groupFramesByReq(frames: AgentEnvelope[]): Map<string, AgentEnvelope[]> {
  const grouped = new Map<string, AgentEnvelope[]>();
  let current = '';

  for (const frame of frames) {
    if (frame.reqID) current = frame.reqID;
    if (!current) continue;
    const list = grouped.get(current);
    if (list) list.push(frame);
    else grouped.set(current, [frame]);
  }
  return grouped;
}

function eventNameOf(frame: AgentEnvelope): string {
  return (frame.data as AgentEventData | undefined)?.event || frame.type;
}

/**
 * 一组帧 → 一条助手消息的内容。
 *
 * 严格按帧的到达顺序铺 timeline：思考 / 工具 / 正文会交错，渲染才能还原
 * 「思考 → 工具 → 回答 → 思考 → 回答」的真实过程。
 */
export function contentFromFrames(frames: AgentEnvelope[]): AgentAssistantContent {
  let timeline: AgentTimelineItem[] = [];
  let media: AgentMedia[] | undefined;
  let sources: AgentSource[] | undefined;
  let error: string | undefined;

  for (const frame of frames) {
    const name = eventNameOf(frame);
    const data = (frame.data ?? {}) as AgentEventData;
    // 回放帧一律是全量快照（delta=false）；实时帧可能是增量
    const replace = data.delta !== true;

    if (
      name === AGENT_EVENT.messageStart ||
      name === AGENT_EVENT.messageDelta ||
      name === AGENT_EVENT.messageCompleted
    ) {
      timeline = appendTimelineText(
        timeline,
        'text',
        frame.eventID,
        data.content ?? '',
        replace,
        name === AGENT_EVENT.messageCompleted,
      );
    } else if (
      name === AGENT_EVENT.reasoningStart ||
      name === AGENT_EVENT.reasoningDelta ||
      name === AGENT_EVENT.reasoningCompleted
    ) {
      timeline = appendTimelineText(
        timeline,
        'reasoning',
        frame.eventID,
        data.reasoning || data.content || '',
        replace,
        name === AGENT_EVENT.reasoningCompleted,
      );
    } else {
      // 工具 / 审批 / 错误：语义与实时一致，直接复用协议映射
      for (const event of mapAgentEnvelope(frame, '')) {
        if (event.type === 'tool') timeline = upsertTimelineTool(timeline, event.step);
        else if (event.type === 'approval') timeline = upsertTimelineApproval(timeline, event.approval);
        else if (event.type === 'error') {
          timeline = upsertTimelineError(timeline, event.message);
          error = event.message;
        }
      }
    }

    // 媒体与引用挂在任意帧上
    for (const event of mapEnvelopeAttachments(frame, '')) {
      if (event.type === 'media') media = event.media;
      else if (event.type === 'sources') sources = event.sources;
    }
  }

  const content = withTimeline({ text: '' }, timeline);
  content.media = media;
  content.sources = sources;
  content.error = error;
  return content;
}

/** 内容里有没有被服务端截断的痕迹（replay.clip 会追加标记） */
export function isTruncatedContent(content: AgentAssistantContent): boolean {
  const bodies = [content.text, content.reasoning ?? ''];
  for (const step of content.steps ?? []) {
    bodies.push(step.content ?? '');
  }
  return bodies.some((body) => body.includes(TRUNCATED_MARK));
}

/**
 * 一轮历史 → 两条消息。
 *
 * 用户消息用 turn.question（帧里的 user_message 在实时/回放两种来源下格式不一致，不可靠）；
 * 助手消息优先用 frames 还原（带思考与工具链），拿不到帧时退回 turn.answer 摘要。
 *
 * 判据用 hasRenderableContent 而不是「有正文或有工具」：被中断的那轮可能只有思考，
 * 只看正文会让这条助手消息整个消失（实时能看到、刷新后就没了）。
 */
export function historyMessagesOf(
  turn: AgentHistoryTurn,
  frames?: AgentEnvelope[],
): AgentMessage[] {
  const messages: AgentMessage[] = [];
  const question = (turn.question ?? '').trim();

  if (question) {
    messages.push({
      key: `h-${turn.seq}-u`,
      role: 'user',
      content: question,
      createdAt: turn.createdAt,
      status: 'done',
    });
  }

  const fromFrames = frames && frames.length > 0 ? contentFromFrames(frames) : undefined;
  const answer = (turn.answer ?? '').trim();
  const content: AgentAssistantContent | undefined =
    fromFrames && hasRenderableContent(fromFrames)
      ? fromFrames
      : answer
        ? { text: answer }
        : undefined;

  if (content) {
    messages.push({
      key: `h-${turn.seq}-a`,
      role: 'assistant',
      content,
      createdAt: turn.completedAt ?? turn.createdAt,
      // completed=false 说明这一轮被中断过
      status: turn.completed ? 'done' : 'aborted',
      turnId: turn.turnID,
      truncated: isTruncatedContent(content),
    });
  }

  return messages;
}
