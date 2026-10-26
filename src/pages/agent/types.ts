/**
 * Agent 对话的领域类型（与协议无关，界面直接消费）。
 *
 * 协议结构见 protocol/，两者之间的翻译在 protocol/downlink/。
 */

export type AgentRole = 'user' | 'assistant';

export type AgentStepStatus = 'loading' | 'success' | 'error';

/** Agent 的一步工具调用，对应后端 data.toolCalls[] */
export type AgentToolStep = {
  /** 对应 ToolCall.id */
  key: string;
  /** 工具名，对应 ToolCall.name */
  title: string;
  /** 参数摘要，对应 ToolCall.params */
  description?: string;
  status: AgentStepStatus;
  /** 工具输出，对应 ToolCall.result */
  content?: string;
};

/** 回答引用的数据来源 */
export type AgentSource = {
  key: string;
  title: string;
  url?: string;
  description?: string;
};

/** 媒体文件，对应后端 types.Media */
export type AgentMedia = {
  type: string;
  url?: string;
  base64?: string;
  mimetype?: string;
  name?: string;
};

/** 审批请求，对应后端 data.approval */
export type AgentApproval = {
  id: string;
  content: string;
};

/** 用户消息里附带的文件（本地选择，暂未上传） */
export type AgentAttachment = {
  uid: string;
  name: string;
  size: number;
  type?: string;
};

/**
 * 一段正文 / 思考。
 *
 * 一轮对话里 codex 可能产出多个 message / reasoning item，每个 item 是一个独立段落；
 * 同一 item 的 start / delta / completed 共享 `eventID`，只更新自己那一段。
 */
export type AgentSegment = {
  /** 上游实体 id（codex item ID）；为空表示服务端没给，归到当前段 */
  id?: string;
  text: string;
};

/** 助手消息的完整内容：正文 + 思考 + 工具链 + 审批 + 媒体 */
export type AgentAssistantContent = {
  text: string;
  /** reasoning_delta 累积出来的思考内容（多段思考用空行拼接） */
  reasoning?: string;
  /**
   * 内部字段：正文 / 思考的分段。`text` / `reasoning` 是它们的拼接结果，
   * 保留分段是为了让「同一段的 completed 全量替换」只替换那一段，不会盖掉别的段。
   */
  textSegments?: AgentSegment[];
  reasoningSegments?: AgentSegment[];
  steps?: AgentToolStep[];
  approval?: AgentApproval;
  media?: AgentMedia[];
  sources?: AgentSource[];
  /**
   * 这一轮以错误收尾（历史回放里的 error 帧）。
   * 与消息级 status='error' 不同：这里表示「这一轮执行失败」的说明文字，
   * 历史里正常显示为一条带错误提示的回答。
   */
  error?: string;
};

export type AgentMessageStatus = 'streaming' | 'done' | 'error' | 'aborted';

export type AgentMessage = {
  key: string;
  role: AgentRole;
  /** 用户消息是纯文本；助手消息是结构化内容 */
  content: string | AgentAssistantContent;
  createdAt: number;
  status: AgentMessageStatus;
  attachments?: AgentAttachment[];
  /** 历史消息对应后端的轮次 id，用于 turn.replay 补全过程 */
  turnId?: string;
  /** 该轮的过程被服务端截断（可用 replay 拉完整版） */
  truncated?: boolean;
};

/**
 * 会话列表里的一条（服务端 session.list 下发，一条对应一个 thread）。
 *
 * 一个 session（`ws_<userID>_<chatID>`）下可以有多个 thread：换过 agent 就会新建，
 * 所以列表里会出现「同一会话的多条对话」，各自延续各自的上下文。
 */
export type AgentSessionSummary = {
  /** 线程标识：拉历史时作为 session.history 的 threadID */
  threadId: string;
  /** 所属会话：续聊时作为 chat.send 的 sessionID */
  sessionId: string;
  agent: string;
  /** 首轮提问（服务端已截断 40 字），纯媒体轮次为空 */
  title: string;
  /** 末轮回答（服务端已截断 80 字） */
  preview: string;
  /** 轮次数量 */
  turns: number;
  /** 末轮是否正常结束：false 表示被中断或仍在生成 */
  completed: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AgentConversation = {
  key: string;
  label: string;
  /** 会话列表分组标题，与 Conversations.groupable 联动 */
  group: string;
  updatedAt: number;
  messages: AgentMessage[];
  /**
   * 服务端标识：只出现在「已落库」的会话上。
   *
   * - threadId：一个 thread 就是一次完整对话，拉历史时按它过滤；
   * - sessionId：续聊时 chat.send 带它（带了这个就不再传 chatID，避免服务端
   *   把 threadID 当成一个新的 chatID）。
   *
   * 两者都为空的是本地草稿（还没发过消息，或刚发出第一轮还没拿到 ack）。
   */
  threadId?: string;
  sessionId?: string;
  /** 列表副标题：末轮回答摘要 */
  preview?: string;
  /** 轮次数量（服务端给，不必拉详情就能显示「共 N 轮」） */
  turns?: number;
  /** 是否已经拉过历史（避免每次切回来都请求一遍） */
  historyLoaded?: boolean;
  /** 历史请求进行中 */
  historyLoading?: boolean;
  /** 后端还有更早的轮次（HistoryThread.hasMore） */
  hasMore?: boolean;
  /** 当前消息里最早一轮的 seq，作为下次 beforeSeq */
  oldestSeq?: number;
  /**
   * 已同步到的最新一轮 turn 的创建时间。
   *
   * 断线补发要拿它当 `since`：服务端按 **turn 的 CreateTime** 过滤，
   * 不能用消息的 createdAt（那是 completedAt，会比 createdAt 晚，反而漏掉正在生成的那轮）。
   */
  lastTurnAt?: number;
  /** 历史里存在被截断的过程（可对单轮 replay 拉完整版） */
  framesTruncated?: boolean;
};

export type AgentConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** 后端 hello 下发的 agent 信息 */
export type AgentInfo = {
  name: string;
  description?: string;
};

/* ------------------------------------------------------------------ */
/* 历史消息（protocol.HistoryTurn / HistoryThread）                     */
/* ------------------------------------------------------------------ */

/** 一轮问答 */
export type AgentHistoryTurn = {
  seq: number;
  reqID: string;
  threadID?: string;
  turnID?: string;
  agent?: string;
  question?: string;
  answer?: string;
  completed: boolean;
  /** 毫秒时间戳 */
  createdAt: number;
  completedAt?: number;
};

/** 一个线程及其轮次（threads 按创建时间升序，turns 按 seq 升序） */
export type AgentHistoryThread = {
  threadID: string;
  agent?: string;
  createdAt?: number;
  lastUpdate?: number;
  turns: AgentHistoryTurn[];
  hasMore?: boolean;
};

/** 判断一条消息是不是助手消息并取出结构化内容 */
export function assistantContentOf(message: AgentMessage): AgentAssistantContent {
  if (typeof message.content === 'string') {
    return { text: message.content };
  }
  return message.content;
}
