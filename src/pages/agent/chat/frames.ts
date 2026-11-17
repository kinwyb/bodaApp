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
import {
  AGENT_EVENT,
  mapAgentEnvelope,
  mapEnvelopeAttachments,
  parseUIEventMessage,
  sendFileMediaOf,
  SEND_FILE_TOOL,
} from '../protocol';
import type {
  AgentAssistantContent,
  AgentAttachment,
  AgentHistoryTurn,
  AgentMedia,
  AgentMessage,
  AgentSource,
  AgentTimelineItem,
} from '../types';
import { hasRenderableContent, timelineOf } from '../types';
import { uiEventStepOf } from './ui-event-buffer';
import {
  appendTimelineText,
  upsertTimelineApproval,
  upsertTimelineUserInput,
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
/**
 * agent 可选：还原 send_file 文件卡片时写进 metadata，供渲染层按 agent + 容器路径
 * 走工作区浏览打开（历史帧没有 fileID 地址）。
 */
export function contentFromFrames(frames: AgentEnvelope[], agent?: string): AgentAssistantContent {
  let timeline: AgentTimelineItem[] = [];
  let media: AgentMedia[] | undefined;
  let sources: AgentSource[] | undefined;
  let error: string | undefined;
  // send_file 成功发送的文件：按 file_path 去重（同一调用会有 started/completed 多帧）
  const sendFiles = new Map<string, AgentMedia>();

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
        if (event.type === 'tool') {
          // send_file 是 agent 发给用户的文件：成功发送的不进过程时间线，
          // 下方按文件卡片还原；失败的仍保留为工具步骤，便于看到错误
          if (event.step.title === SEND_FILE_TOOL && event.step.status !== 'error') continue;
          timeline = upsertTimelineTool(timeline, event.step);
        } else if (event.type === 'approval') {
          // 历史 / 回放里的审批那一轮早已结束，置为 expired，界面不再给可点的按钮
          timeline = upsertTimelineApproval(timeline, { ...event.approval, status: 'expired' });
        } else if (event.type === 'user-input') {
          // 历史 / 回放里的提问同样只读展示，不再提供作答
          timeline = upsertTimelineUserInput(timeline, { ...event.userInput, status: 'expired' });
        } else if (event.type === 'error') {
          timeline = upsertTimelineError(timeline, event.message);
          error = event.message;
        }
      }
    }

    // send_file 的文件只在 completed 帧提取：started 帧还没有结果，
    // 且一次调用只有一帧 completed，天然不会重复
    if (name === AGENT_EVENT.toolCompleted) {
      for (const call of data.toolCalls ?? []) {
        const file = sendFileMediaOf(call);
        if (!file) continue;
        if (agent) file.metadata = { ...file.metadata, agent };
        const key = String(file.metadata?.filePath || file.name || call.id || '');
        if (!sendFiles.has(key)) sendFiles.set(key, file);
      }
    }

    // 媒体与引用挂在任意帧上；但用户帧的 media 是用户上传的附件，
    // 归属用户消息（见 userAttachmentsOf），不能并进助手回答
    if (data.role !== 'user') {
      for (const event of mapEnvelopeAttachments(frame, '')) {
        if (event.type === 'media') media = event.media;
        else if (event.type === 'sources') sources = event.sources;
      }
    }
  }

  if (sendFiles.size > 0) media = [...(media ?? []), ...sendFiles.values()];

  const content = withTimeline({ text: '' }, timeline);
  content.media = media;
  content.sources = sources;
  content.error = error;
  return content;
}

/**
 * 从 user_message 帧的 media 还原用户消息附件。
 *
 * 用户上传的文件被服务端移进工作区后，会挂在 user_message 帧的 data.media 上
 * （url 为容器路径）。这里把它转成用户消息的附件，而不是助手回答的媒体。
 * 本地路径记 filePath + agent，渲染层换工作区 URL 打开；远程 URL 直接可用。
 */
export function userAttachmentsOf(
  frames: AgentEnvelope[] | undefined,
  agent: string | undefined,
  seq: number,
): AgentAttachment[] | undefined {
  for (const frame of frames ?? []) {
    const data = (frame.data ?? {}) as AgentEventData;
    if (data.role !== 'user' || !data.media?.length) continue;
    for (const event of mapEnvelopeAttachments(frame, '')) {
      if (event.type !== 'media') continue;
      return event.media.map((m, index) => {
        const url = m.url ?? '';
        const remote = /^https?:\/\//i.test(url);
        const name =
          m.name || url.split(/[?#]/)[0].split(/[/\\]/).pop() || `附件 ${index + 1}`;
        const attachment: AgentAttachment = {
          uid: `h-${seq}-u-${index}`,
          name,
          size: m.size ?? 0,
          type: m.mimetype,
          status: 'done',
        };
        if (remote) attachment.url = url;
        else if (url) {
          attachment.filePath = url;
          attachment.agent = agent;
        }
        return attachment;
      });
    }
  }
  return undefined;
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
  const rawQuestion = (turn.question ?? '').trim();
  const uiEvents = parseUIEventMessage(rawQuestion);
  const question = uiEvents ? uiEvents.userText : rawQuestion;
  const attachments = userAttachmentsOf(frames, turn.agent, turn.seq);

  if (question || attachments?.length) {
    messages.push({
      key: `h-${turn.seq}-u`,
      role: 'user',
      content: question,
      createdAt: turn.createdAt,
      status: 'done',
      attachments,
    });
  }

  const fromFrames = frames && frames.length > 0 ? contentFromFrames(frames, turn.agent) : undefined;
  const answer = (turn.answer ?? '').trim();
  let content: AgentAssistantContent | undefined =
    fromFrames && hasRenderableContent(fromFrames)
      ? fromFrames
      : answer
        ? { text: answer }
        : undefined;

  /*
   * 普通事件批次在服务端会从 userMessage 还原成工具帧；老数据或 frames 被裁掉时，
   * 这里从 question 里的稳定标记补建，避免刷新后页面操作消失。
   */
  if (uiEvents && uiEvents.events.length > 0) {
    const base = content ?? { text: '' };
    const timeline = timelineOf(base);
    if (!timeline.some((item) => item.kind === 'tool' && item.step.origin === 'ui-event')) {
      const step = uiEventStepOf(uiEvents.events, `ui-event-${turn.turnID || turn.seq}`);
      content = withTimeline(base, [
        { kind: 'tool', key: step.key, step },
        ...timeline,
      ]);
    }
  }

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
