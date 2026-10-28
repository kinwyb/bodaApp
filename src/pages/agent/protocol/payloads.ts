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
  /**
   * 已上传文件的标识（见 files/client.ts 的上传接口）。
   * 服务端会把它们还原成 media 追加在 media 之后投递给 agent，
   * 所以这里只传 ID，帧里不带文件内容。
   */
  fileIDs?: string[];
  metadata?: Record<string, unknown>;
};

/**
 * protocol.FileInfo：文件元信息。
 *
 * 既是上传接口的响应体，也是 chat.send 里 fileIDs 指向的对象。
 * url 是**相对地址**（形如 `/ws/files/<id>`）：服务端躲在反向代理后面时
 * 并不知道浏览器实际用的 host，绝对地址交给前端自己拼（见 files/client.ts）。
 */
export type FileInfoData = {
  id: string;
  name: string;
  size: number;
  /** 由文件名后缀推断，取不到时为空 */
  mime?: string;
  /** 相对访问地址 */
  url: string;
  /** 毫秒时间戳，过期后该 fileID 失效 */
  expiresAt?: number;
};

/** protocol.FileListData：GET /ws/files 与上传接口的响应体（一个文件也是数组） */
export type FileListData = {
  items: FileInfoData[];
};

/** 文件端点的错误体：HTTP 4xx/5xx 直接返回 {code,message} */
export type FileErrorData = {
  code?: string;
  message?: string;
};

/** protocol.ChatCancelData（上行） */
export type ChatCancelData = {
  sessionID?: string;
  chatID?: string;
};

/** protocol.SessionListData（上行：拉取对话列表） */
export type SessionListData = {
  /** 返回条数：0 用默认 50，负数取全量（上限 200） */
  limit?: number;
  /** 翻页游标：只取最后更新时间早于该时刻（毫秒）的对话 */
  beforeLastUpdate?: number;
  /** 与 beforeLastUpdate 组成复合游标（同一毫秒有多条时续接用） */
  beforeThreadID?: string;
};

/** protocol.SessionListItem（下行：一条对应一个 thread） */
export type SessionListItem = {
  /** 线程标识，拉历史时作为 session.history 的 threadID */
  threadID?: string;
  /** 所属会话，续聊时作为 chat.send 的 sessionID */
  sessionID?: string;
  agent?: string;
  /** 首轮提问（40 字截断）；纯媒体轮次为空 */
  title?: string;
  /** 末轮回答（80 字截断），列表页做副标题 */
  preview?: string;
  /** 轮次数量 */
  turns?: number;
  /** 末轮是否正常结束 */
  completed?: boolean;
  createdAt?: number;
  lastUpdate?: number;
};

/** protocol.SessionListResult（下行） */
export type SessionListResult = {
  items?: SessionListItem[];
  hasMore?: boolean;
  nextBeforeLastUpdate?: number;
  nextBeforeThreadID?: string;
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
