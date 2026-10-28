/**
 * 状态层：会话状态机用到的 action 与工厂函数。
 *
 * 只描述「发生了什么」，不关心事件从哪来（ws / mock 都会走同一批 action）。
 */

import type { AgentEnvelope } from '../protocol';
import type {
  AgentAssistantContent,
  AgentConversation,
  AgentSessionSummary,
  AgentHistoryThread,
  AgentMedia,
  AgentMessage,
  AgentSource,
  AgentTokenUsage,
  AgentToolStep,
} from '../types';

export const DEFAULT_LABEL = '新对话';

let messageSeed = 0;

export function nextMessageKey(prefix: string): string {
  messageSeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${messageSeed}`;
}

export function createConversation(): AgentConversation {
  return {
    // chatID 会直接发给后端，保持「无下划线」——服务端会话键 = {channel}_{userID}_{chatID}，
    // 前端要靠最后一段反解回会话
    key: `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: DEFAULT_LABEL,
    group: '今天',
    updatedAt: Date.now(),
    messages: [],
  };
}

export type AgentChatState = {
  conversations: AgentConversation[];
  activeKey: string;
};

/** 历史响应并入本地消息的三种方式 */
export type HistoryMode = 'replace' | 'prepend' | 'append';

export type AgentChatAction =
  | { type: 'switch'; key: string }
  | { type: 'create'; conversation: AgentConversation }
  | { type: 'rename'; key: string; label: string }
  | { type: 'remove'; key: string }
  | { type: 'clear'; key: string }
  /**
   * 会话列表（服务端 session.list 的结果）。
   *
   * 合并规则见 reducer：服务端条目按 threadID 对齐，本地草稿靠 sessionID 认领
   * 「自己在列表里的那一项」，认领不上的草稿留在最前面（还没落库的新对话）。
   */
  | { type: 'sessions'; items: AgentSessionSummary[]; mode?: 'replace' | 'append' }
  /**
   * 服务端确认了这条会话的 sessionID / threadID（ack、历史响应里带回来）。
   *
   * 只补字段、不动别的：草稿要凭它才能和会话列表里的条目对上。
   */
  | { type: 'bind'; conversationKey: string; sessionId?: string; threadId?: string }
  | { type: 'append'; conversationKey: string; messages: AgentMessage[]; autoLabel?: string }
  | { type: 'replyStart'; conversationKey: string; messageKey: string }
  | {
      type: 'appendText';
      conversationKey: string;
      text: string;
      replace: boolean;
      /** 上游实体 id：换 id 说明是同一轮里的另一段 */
      eventId?: string;
      /** 该片段是否已结束（completed 帧）：结束后不再显示流式光标 */
      done?: boolean;
    }
  | {
      type: 'appendReasoning';
      conversationKey: string;
      text: string;
      replace: boolean;
      eventId?: string;
      /** 思考结束（reasoning_completed）：转圈图标据此停下 */
      done?: boolean;
    }
  | { type: 'upsertStep'; conversationKey: string; step: AgentToolStep }
  | { type: 'setApproval'; conversationKey: string; approval: AgentAssistantContent['approval'] }
  | { type: 'setMedia'; conversationKey: string; media: AgentMedia[] }
  | { type: 'setSources'; conversationKey: string; sources: AgentSource[] }
  /**
   * token 用量更新（token_usage 帧）。
   *
   * 只动会话级的用量面板，不碰消息内容：同一轮会多次到达（每次模型调用后一次），
   * 服务端给的就是「累计 + 本轮」的当前事实，合并后覆盖即可。
   */
  | { type: 'usage'; conversationKey: string; usage: AgentTokenUsage }
  | {
      type: 'history';
      conversationKey: string;
      threads: AgentHistoryThread[];
      /** 与实时流同构的逐帧过程，按 reqID 归组还原 */
      frames: AgentEnvelope[];
      framesTruncated: boolean;
      mode: HistoryMode;
    }
  /** 单轮完整过程回放：把某一轮的消息内容换成未截断的版本 */
  | {
      type: 'replayTurn';
      conversationKey: string;
      turnId: string;
      frames: AgentEnvelope[];
      truncated: boolean;
    }
  | { type: 'historyStart'; conversationKey: string }
  | { type: 'finish' | 'stop'; conversationKey: string }
  | { type: 'fail'; conversationKey: string; message: string }
  | { type: 'resetReply'; conversationKey: string; messageKey: string };
