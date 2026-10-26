/**
 * 状态层：会话状态机用到的 action 与工厂函数。
 *
 * 只描述「发生了什么」，不关心事件从哪来（ws / mock 都会走同一批 action）。
 */

import type { AgentEnvelope } from '../protocol';
import type {
  AgentAssistantContent,
  AgentConversation,
  AgentHistoryThread,
  AgentMedia,
  AgentMessage,
  AgentSource,
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
   * 把本地会话 key 对齐到服务端下发的 chatID。
   *
   * token 里可能已经带了 chatID（续接别的端的对话），服务端握手时会通过 hello 告诉我们；
   * 此时本地如果继续用自己的 key，消息会分裂成两个会话。
   */
  | { type: 'rebindConversation'; fromKey: string; toKey: string }
  | { type: 'append'; conversationKey: string; messages: AgentMessage[]; autoLabel?: string }
  | { type: 'replyStart'; conversationKey: string; messageKey: string }
  | {
      type: 'appendText';
      conversationKey: string;
      text: string;
      replace: boolean;
      /** 上游实体 id：换 id 说明是同一轮里的另一段 */
      eventId?: string;
    }
  | {
      type: 'appendReasoning';
      conversationKey: string;
      text: string;
      replace: boolean;
      eventId?: string;
    }
  | { type: 'upsertStep'; conversationKey: string; step: AgentToolStep }
  | { type: 'setApproval'; conversationKey: string; approval: AgentAssistantContent['approval'] }
  | { type: 'setMedia'; conversationKey: string; media: AgentMedia[] }
  | { type: 'setSources'; conversationKey: string; sources: AgentSource[] }
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
