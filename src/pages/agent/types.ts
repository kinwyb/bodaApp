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

/**
 * 媒体文件，对应后端 types.Media。
 *
 * url 有两种形态：
 * - `/ws/files/<id>`：下行附件（agent 的 send_file），相对地址，渲染前要拼成可访问地址
 *   （见 files/client.ts 的 resolveAgentFileUrl）；
 * - `http(s)://…`：agent 直接给的远程地址，原样使用。
 */
export type AgentMedia = {
  type: string;
  url?: string;
  base64?: string;
  mimetype?: string;
  /** 展示名：由下行映射从 metadata.filename 补上 */
  name?: string;
  /** 字节数（metadata.size） */
  size?: number;
  /** 文件服务里的标识（metadata.fileID），删除/查元信息时用 */
  fileId?: string;
  /** 后端原样透传的元数据（filename / fileID / size / caption 等） */
  metadata?: Record<string, unknown>;
};

/** 审批请求，对应后端 data.approval */
export type AgentApproval = {
  id: string;
  content: string;
};

/** 附件的上传状态：选完文件就开始传，发送只认 done 的那些 */
export type AgentAttachmentStatus = 'uploading' | 'done' | 'error';

/**
 * 用户消息里附带的文件。
 *
 * 文件本体不跟着消息走：选中时先 POST 到 `/ws/files` 拿 fileID，
 * 发送时 chat.send 只带 fileIDs（见 files/client.ts）。
 */
export type AgentAttachment = {
  uid: string;
  name: string;
  size: number;
  type?: string;
  /**
   * 上传成功后的 fileID。为空有两种情况：
   * 演示模式（没有真实服务）、或上传失败 —— 失败的附件不会被发送。
   */
  fileId?: string;
  /** 缺省视为 done（历史消息里的老附件没有这个字段） */
  status?: AgentAttachmentStatus;
  /** 上传失败的提示文案 */
  error?: string;
  /** 上传进度 0-100，仅 uploading 时有意义 */
  percent?: number;
  /** 服务端给的可访问地址（相对 /ws/files/<id>），点开预览时用 */
  url?: string;
};

/**
 * 一轮回答里的一个片段，按**到达顺序**排列。
 *
 * 关键：后端的思考与正文是交错的（思考 → 工具 → 回答 → 思考 → 回答 …），
 * 早期版本把它们按类型分成三堆渲染，多轮思考后完全看不出先后。
 * 现在统一进 timeline，渲染严格按数组顺序走。
 */
export type AgentTimelineItem =
  | { kind: 'reasoning'; key: string; eventId?: string; text: string; done: boolean }
  | { kind: 'text'; key: string; eventId?: string; text: string; done: boolean }
  | { kind: 'tool'; key: string; step: AgentToolStep }
  | { kind: 'approval'; key: string; approval: AgentApproval }
  | { kind: 'error'; key: string; message: string };

/** 助手消息的完整内容：时间线 + 派生汇总 + 媒体/引用 */
export type AgentAssistantContent = {
  /**
   * 渲染真源：思考 / 工具 / 正文按到达顺序交错。
   *
   * 历史消息来自旧数据时可能没有（用 timelineOf 由 text/steps 合成）。
   */
  timeline?: AgentTimelineItem[];
  text: string;
  /** reasoning_delta 累积出来的思考内容（多段思考用空行拼接） */
  reasoning?: string;
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
  /** 该对话的累计 token 用量（列表接口直接给，列表页可展示消耗） */
  usage?: AgentTokenUsage;
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
  /**
   * 这条会话的 token 用量（输入框下方展示）。
   *
   * 三个来源合流：实时 `token_usage` 帧、`session.history` 的线程/轮次级用量、
   * `session.list` 的列表项累计值 —— 刷新页面后不必等新帧才有数。
   */
  usage?: AgentTokenUsage;
};

export type AgentConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** 后端 hello 下发的 agent 信息 */
export type AgentInfo = {
  name: string;
  description?: string;
};

/* ------------------------------------------------------------------ */
/* token 用量（types.TokenUsage）                                       */
/* ------------------------------------------------------------------ */

/** 一份 token 拆分（累计或单轮），字段齐全，缺失按 0 归一 */
export type AgentTokenDetail = {
  totalTokens: number;
  inputTokens: number;
  /** 命中缓存的输入 token */
  cachedInputTokens: number;
  /** 写入缓存的输入 token */
  cacheWriteInputTokens: number;
  outputTokens: number;
  /** 深度思考消耗的 token（含在 outputTokens 里，不重复相加） */
  reasoningOutputTokens: number;
};

/**
 * 一条会话的 token 用量。
 *
 * - `total`：整段对话累计（服务端 session.list / session.history 的线程级用量）
 * - `last`：最近一次模型调用的消耗（实时帧的轮次级用量）
 * - `contextWindow`：模型上下文窗口，0 表示上游没给
 */
export type AgentTokenUsage = {
  total: AgentTokenDetail;
  last: AgentTokenDetail;
  contextWindow: number;
};

/**
 * 这份明细是不是空的（没有真实 token 数）。
 *
 * 用来判断「这一路数据有没有给用量」：history 的轮次级只给 last、
 * 列表只给 total，缺的那一层是全 0 —— 合并时不能拿它去覆盖已有的值。
 */
export function isEmptyTokenDetail(detail: AgentTokenDetail): boolean {
  return detail.totalTokens === 0 && detail.inputTokens === 0 && detail.outputTokens === 0;
}

/** 空明细（引用稳定，多层合并时省掉一半对象分配） */
export const EMPTY_TOKEN_DETAIL: AgentTokenDetail = {
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
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
  /**
   * 本轮 token 用量：只有 `last`（本轮）与 `contextWindow` 有值，`total` 恒为 0。
   * 对话累计看 AgentHistoryThread.usage；老数据没记录时为 undefined。
   */
  usage?: AgentTokenUsage;
};

/** 一个线程及其轮次（threads 按创建时间升序，turns 按 seq 升序） */
export type AgentHistoryThread = {
  threadID: string;
  agent?: string;
  createdAt?: number;
  lastUpdate?: number;
  turns: AgentHistoryTurn[];
  hasMore?: boolean;
  /** 该对话的累计用量：只有 `total` 有值 */
  usage?: AgentTokenUsage;
};

/**
 * 渲染用：取内容的时间线。
 *
 * 旧消息（没有 timeline）按原渲染顺序合成一个 —— 思考 → 工具 → 错误 → 正文，
 * 等价于改造前的观感，不会因为升级而丢内容。
 */
export function timelineOf(content: AgentAssistantContent): AgentTimelineItem[] {
  if (content.timeline && content.timeline.length > 0) return content.timeline;

  const built: AgentTimelineItem[] = [];
  if (content.reasoning) {
    built.push({ kind: 'reasoning', key: 'legacy-reasoning', text: content.reasoning, done: true });
  }
  (content.steps ?? []).forEach((step) => {
    built.push({ kind: 'tool', key: `legacy-tool-${step.key}`, step });
  });
  if (content.error) {
    built.push({ kind: 'error', key: 'legacy-error', message: content.error });
  }
  if (content.text) {
    built.push({ kind: 'text', key: 'legacy-text', text: content.text, done: true });
  }
  return built;
}

/** 判断一条消息是不是助手消息并取出结构化内容 */
export function assistantContentOf(message: AgentMessage): AgentAssistantContent {
  if (typeof message.content === 'string') {
    return { text: message.content };
  }
  return message.content;
}

/**
 * 这段内容有没有可显示的东西（思考 / 工具 / 正文 / 审批 / 错误任一片段，或媒体与引用）。
 *
 * 判据必须是整条时间线，不能只看 `text` 与 `steps`：真实一轮常常是「思考 → 工具 → 正文」，
 * 只看后两者会让「只有思考」的这段时间被当成空的。骨架屏就中过这个招：
 * Bubble 在 loading=true 时根本不渲染内容，于是首轮的思考一直被骨架压着，
 * 直到第一次工具调用才把攒下的思考一次性放出来（现象是首轮不流式，之后正常）。
 */
export function hasRenderableContent(content: AgentAssistantContent): boolean {
  return (
    timelineOf(content).length > 0 ||
    Boolean(content.media?.length) ||
    Boolean(content.sources?.length)
  );
}
