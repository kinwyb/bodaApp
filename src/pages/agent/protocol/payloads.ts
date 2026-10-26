/**
 * 协议载荷（对齐 buibuiCodex/core/ws/protocol/payload.go）。
 *
 * 只声明前端会读写的字段，其余忽略即可。
 */

import type { AgentHistoryThread, AgentInfo, AgentMedia } from '../types';
import type { AgentEnvelope } from './envelope';

/** protocol.AgentData：kind=agent 的 data */
export type AgentEventData = {
  event?: string;
  agent?: string;
  role?: string;
  /** 是否为增量片段；false 表示全量内容，需要替换 */
  delta?: boolean;
  content?: string;
  reasoning?: string;
  toolCalls?: AgentToolCall[];
  media?: AgentMedia[];
  approval?: { id?: string; content?: string; extra?: Record<string, unknown> };
  error?: { code?: string; message?: string; detail?: string };
  meta?: Record<string, unknown>;
};

/** types.ToolCall */
export type AgentToolCall = {
  id?: string;
  type?: string;
  name?: string;
  params?: string;
  result?: string;
  extra?: Record<string, unknown>;
};

/** protocol.HelloData */
export type HelloData = {
  clientID?: string;
  /** 当前连接的用户身份，会话键为 {channel}_{userID}_{chatID} */
  userID?: string;
  /** 服务端确定的当前对话；客户端后续不传 chatID 时消息都落这里 */
  chatID?: string;
  protocol?: number;
  agents?: AgentInfo[];
  defaultAgent?: string;
  /** 心跳间隔（秒） */
  heartbeat?: number;
};

/** protocol.AckData */
export type AckData = {
  ok?: boolean;
  sessionID?: string;
  /** 服务端实际使用的对话标识（请求未带时由服务端生成） */
  chatID?: string;
  reqID?: string;
  message?: string;
};

/** protocol.PongData */
export type PongData = {
  clientTS?: number;
  serverTS?: number;
};

/** protocol.ErrorBody */
export type ErrorBody = {
  code?: string;
  message?: string;
  detail?: string;
};

/** protocol.ChatSendData（上行） */
export type ChatSendData = {
  sessionID?: string;
  chatID?: string;
  agent?: string;
  content?: string;
  media?: AgentMedia[];
  metadata?: Record<string, unknown>;
};

/** protocol.ChatCancelData（上行） */
export type ChatCancelData = {
  sessionID?: string;
  chatID?: string;
};

/** protocol.SessionHistoryData（上行） */
export type SessionHistoryData = {
  sessionID?: string;
  chatID?: string;
  threadID?: string;
  /** 翻页游标：只取 seq 小于该值的轮次 */
  beforeSeq?: number;
  /** 增量补发：毫秒时间戳 */
  since?: number;
  /** 每线程条数：0 用默认 200，负数取全量（上限 1000） */
  limit?: number;
  /** 是否附带逐帧执行过程（思考 / 工具 / 审批 / 错误） */
  includeFrames?: boolean;
};

/** protocol.SessionHistoryResult（下行） */
export type SessionHistoryResult = {
  sessionID?: string;
  threads?: AgentHistoryThread[];
  /** 按「线程顺序 + 轮次顺序」铺平的 agent 信封，与实时流同构；同轮共享 reqID */
  frames?: AgentEnvelope[];
  /** 是否有轮次的过程被条数/体积上限截断 */
  framesTruncated?: boolean;
};

/** protocol.TurnReplayData（上行：回放单轮完整过程） */
export type TurnReplayData = {
  sessionID?: string;
  chatID?: string;
  /** 轮次标识，必填 */
  turnID: string;
  /** 只取 seq 大于该值的事件 */
  afterSeq?: number;
  /** 帧数：0 用默认 500，负数取全量（上限 20000） */
  limit?: number;
};

/** protocol.TurnReplayResult（下行） */
export type TurnReplayResult = {
  sessionID?: string;
  turnID?: string;
  frames?: AgentEnvelope[];
  hasMore?: boolean;
  /** 下次翻页游标，等于最后一帧的 seq */
  nextAfterSeq?: number;
  /** 是否有内容因体积上限被截断 */
  truncated?: boolean;
};
