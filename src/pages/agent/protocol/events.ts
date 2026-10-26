/**
 * 语义事件：协议报文翻译成「界面能直接吃的动作」。
 *
 * 传输层（transport/）产出这些事件，状态层（chat/）消费它们；
 * 页面永远不接触 envelope / kind / type 这些协议概念。
 */

import type { AgentApproval, AgentHistoryThread, AgentMedia, AgentSource, AgentToolStep } from '../types';

export type AgentStreamEvent =
  /** 一条回答开始（message_start） */
  | { type: 'reply-start'; conversationId: string }
  /**
   * 正文增量；replace=true 表示 data.delta=false，是全量内容。
   * eventId 是上游实体（codex item）标识：换 id 说明是同一轮里的另一段正文。
   */
  | { type: 'text'; conversationId: string; text: string; replace: boolean; eventId?: string }
  | { type: 'reasoning'; conversationId: string; text: string; replace: boolean; eventId?: string }
  /** 工具调用的一步（tool_start → loading，tool_completed → success/error） */
  | { type: 'tool'; conversationId: string; step: AgentToolStep }
  | { type: 'approval'; conversationId: string; approval: AgentApproval }
  | { type: 'media'; conversationId: string; media: AgentMedia[] }
  | { type: 'sources'; conversationId: string; sources: AgentSource[] }
  /**
   * 历史消息：
   * - replace 首次打开整体替换
   * - prepend 往上翻页（插到前面）
   * - append  断线增量补发（接在后面）
   *
   * frames 是「与实时流同构」的逐帧过程（思考 / 工具 / 审批 / 错误），
   * 同一轮共享 reqID，状态层按它还原出带过程的消息，比 turns 的问答摘要完整。
   */
  | {
      type: 'history';
      conversationId: string;
      threads: AgentHistoryThread[];
      frames: import('./envelope').AgentEnvelope[];
      /** 有轮次的过程被服务端截断（可通过 replay 拉完整版） */
      framesTruncated: boolean;
      mode: 'replace' | 'prepend' | 'append';
    }
  /** 单轮完整过程回放（session.turn.replay 的响应） */
  | {
      type: 'replay';
      conversationId: string;
      turnId: string;
      frames: import('./envelope').AgentEnvelope[];
      hasMore: boolean;
      nextAfterSeq?: number;
      truncated: boolean;
    }
  /** 一轮回答结束（finished） */
  | { type: 'reply-done'; conversationId: string }
  /**
   * 服务端确认了这条会话的 sessionID（来自 ack / 历史响应）。
   *
   * 状态层据此把本地草稿和「会话列表」里的同一条对上：
   * 草稿没有 threadID，靠 sessionID 才能认领自己在列表里的那一项，避免刷新列表后重复出现。
   */
  | { type: 'session-bound'; conversationId: string; sessionId: string }
  /** conversationId 为空表示连接级错误 */
  | { type: 'error'; conversationId: string; message: string };

/** 单个下行事件处理函数的签名；返回 undefined 表示「不是我的事件」 */
export type AgentEventHandler = (
  name: string,
  data: import('./payloads').AgentEventData,
  conversationId: string,
  /** 原始信封，用来取 eventID（按实体归并需要的） */
  envelope: import('./envelope').AgentEnvelope,
) => AgentStreamEvent[] | undefined;
