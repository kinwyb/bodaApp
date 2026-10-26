/**
 * 传输层接口：页面/状态层只依赖这里的形状，不关心底下是 WebSocket 还是演示脚本。
 */

import type { AgentConnectionStatus } from '../types';
import type { AgentStreamEvent, HelloInfo } from '../protocol';

export type AgentSendPayload = {
  /** 前端会话 key，作为后端 chatID */
  conversationId: string;
  content: string;
  /** 指定 agent，为空用服务端默认 */
  agent?: string;
  attachments?: { name: string; size: number }[];
};

export type AgentHistoryQuery = {
  conversationId: string;
  threadID?: string;
  /** 翻页游标：只取 seq 小于该值的轮次（加载更早的消息） */
  beforeSeq?: number;
  /** 增量补发：毫秒时间戳 */
  since?: number;
  /** 每线程条数，0 用服务端默认，负数取全量 */
  limit?: number;
  /** 是否附带逐帧执行过程（默认 true：历史里要显示思考与工具链） */
  includeFrames?: boolean;
  /**
   * 响应怎么并入本地消息（前端内部用，不发给后端）：
   * replace = 首次打开整体替换，prepend = 往上翻页，append = 断线增量补发
   */
  mode?: 'replace' | 'prepend' | 'append';
};

/** 单轮回放：拿某一轮未截断的完整过程 */
export type AgentReplayQuery = {
  conversationId: string;
  /** 轮次标识（HistoryTurn.turnID） */
  turnId: string;
  /** 续拉：只取 seq 大于该值的事件 */
  afterSeq?: number;
  limit?: number;
};

/** hello 握手信息 */
export type AgentHello = HelloInfo;

export type AgentTransport = {
  kind: 'mock' | 'websocket';
  connect(): void;
  disconnect(): void;
  send(payload: AgentSendPayload): void;
  /** 拉取历史（同时让服务端订阅该会话，重连后仍能收实时事件） */
  history(query: AgentHistoryQuery): void;
  /** 回放某一轮的完整执行过程（不限帧数、不截断） */
  replay(query: AgentReplayQuery): void;
  abort(conversationId: string): void;
  onEvent(listener: (event: AgentStreamEvent) => void): () => void;
  onStatusChange(listener: (status: AgentConnectionStatus) => void): () => void;
  onHello(listener: (hello: AgentHello) => void): () => void;
  onLatency(listener: (ms: number) => void): () => void;
};
