/**
 * 传输层接口：页面/状态层只依赖这里的形状，不关心底下是 WebSocket 还是演示脚本。
 */

import type { AgentConnectionStatus } from '../types';
import type { AgentSessionPage, AgentStreamEvent, HelloInfo } from '../protocol';

export type AgentSendPayload = {
  /** 前端会话 key；会话还没落库时它就当后端 chatID 用 */
  conversationId: string;
  /**
   * 已落库会话的 sessionID（来自会话列表）。带了它就不再传 chatID ——
   * 服务端会用 chatID 建连接上下文，把 threadID 当 chatID 传会串到另一个对话上。
   */
  sessionId?: string;
  content: string;
  /** 指定 agent，为空用服务端默认 */
  agent?: string;
  attachments?: { name: string; size: number }[];
};

export type AgentHistoryQuery = {
  conversationId: string;
  /** 已落库会话的 sessionID（传了它就不传 chatID） */
  sessionId?: string;
  /** 线程标识：一个 thread 是一次完整对话，只取该线程的轮次 */
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
  /** 已落库会话的 sessionID（传了它就不传 chatID） */
  sessionId?: string;
  /** 轮次标识（HistoryTurn.turnID） */
  turnId: string;
  /** 续拉：只取 seq 大于该值的事件 */
  afterSeq?: number;
  limit?: number;
};

/** 会话列表查询：limit 0 用服务端默认（50），负数取全量（上限 200） */
export type AgentSessionQuery = {
  limit?: number;
  /** 翻页游标：只取最后更新时间早于该时刻（毫秒）的对话 */
  beforeLastUpdate?: number;
  /** 与 beforeLastUpdate 组成复合游标 */
  beforeThreadID?: string;
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
  /** 拉取对话列表（session.list），结果通过 onSessions 回调 */
  sessions(query?: AgentSessionQuery): void;
  /** 回放某一轮的完整执行过程（不限帧数、不截断） */
  replay(query: AgentReplayQuery): void;
  /** 中断当前会话；已知 sessionID 时带上，避免用本地 key 去推导 */
  abort(conversationId: string, sessionId?: string): void;
  onEvent(listener: (event: AgentStreamEvent) => void): () => void;
  onStatusChange(listener: (status: AgentConnectionStatus) => void): () => void;
  onHello(listener: (hello: AgentHello) => void): () => void;
  onSessions(listener: (page: AgentSessionPage) => void): () => void;
  onLatency(listener: (ms: number) => void): () => void;
};
