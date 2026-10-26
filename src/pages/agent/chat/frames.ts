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

import type { AgentEnvelope, AgentEventData, AgentStreamEvent } from '../protocol';
import { mapAgentEnvelope, mapEnvelopeAttachments } from '../protocol';
import type { AgentAssistantContent, AgentHistoryTurn, AgentMessage, AgentToolStep } from '../types';
import { joinSegments, upsertSegment } from './helpers';

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

/** 一组帧 → 一条助手消息的内容 */
export function contentFromFrames(frames: AgentEnvelope[]): AgentAssistantContent {
  const content: AgentAssistantContent = { text: '' };
  const steps = new Map<string, AgentToolStep>();

  for (const frame of frames) {
    const name = eventNameOf(frame);
    const data = (frame.data ?? {}) as AgentEventData;
    // 回放帧一律是全量快照（delta=false）；实时帧可能是增量
    const replace = data.delta !== true;

    if (name === 'message_start' || name === 'message_delta' || name === 'message_completed') {
      if (data.content) {
        const textSegments = upsertSegment(content.textSegments, frame.eventID, data.content, replace);
        content.textSegments = textSegments;
        content.text = joinSegments(textSegments);
      }
    } else if (name === 'reasoning_start' || name === 'reasoning_delta' || name === 'reasoning_completed') {
      const piece = data.reasoning || data.content;
      if (piece) {
        const reasoningSegments = upsertSegment(
          content.reasoningSegments,
          frame.eventID,
          piece,
          replace,
        );
        content.reasoningSegments = reasoningSegments;
        content.reasoning = joinSegments(reasoningSegments);
      }
    } else {
      // 工具 / 审批 / 错误等：语义与实时一致，直接复用协议映射
      for (const event of mapAgentEnvelope(frame, '')) {
        applyEvent(content, steps, event);
      }
    }

    // 媒体与引用挂在任意帧上
    for (const event of mapEnvelopeAttachments(frame, '')) {
      applyEvent(content, steps, event);
    }
  }

  if (steps.size > 0) content.steps = [...steps.values()];
  return content;
}

function applyEvent(
  content: AgentAssistantContent,
  steps: Map<string, AgentToolStep>,
  event: AgentStreamEvent,
) {
  switch (event.type) {
    case 'tool':
      // 同一个 ToolCall.id 先 loading 后 success，后到的覆盖
      steps.set(event.step.key, event.step);
      break;
    case 'approval':
      content.approval = event.approval;
      break;
    case 'media':
      content.media = event.media;
      break;
    case 'sources':
      content.sources = event.sources;
      break;
    case 'error':
      content.error = event.message;
      break;
    default:
      break;
  }
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
    fromFrames && (fromFrames.text || fromFrames.steps?.length || fromFrames.error)
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
