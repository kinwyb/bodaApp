/**
 * 传输信封与协议常量（对齐 buibuiCodex/core/ws/protocol/envelope.go）。
 *
 * 上下行统一结构：{ v, id, kind, type, sessionID, reqID, replyTo, seq, chunk, ts, data }
 * - kind 分域：client（上行）/ system（握手、应答、错误、心跳）/ agent（流式事件）
 * - 未知 kind 与未知 type 一律忽略，服务端可平滑扩展
 */

export type AgentEnvelope = {
  v: number;
  id: string;
  kind: string;
  type: string;
  sessionID?: string;
  reqID?: string;
  /**
   * 产生本帧的上游实体标识（codex item ID / callId）。
   *
   * 消息、思考、工具类帧的 start / delta / completed 共享同一个值，
   * 前端据此把同一实体的多次更新归并到一份，**不必依赖到达顺序**。
   * 审批帧不填（用 data.approval.id），系统类帧可能为空。
   */
  eventID?: string;
  replyTo?: string;
  seq?: number;
  chunk?: number;
  ts: number;
  data?: unknown;
};

export const PROTOCOL_VERSION = 1;

/** 消息域 */
export const KIND = {
  agent: 'agent',
  system: 'system',
  client: 'client',
} as const;

/** 上行命令（kind=client） */
export const CLIENT_TYPE = {
  chatSend: 'chat.send',
  chatCancel: 'chat.cancel',
  sessionHistory: 'session.history',
  /** 回放单轮的完整执行过程 */
  turnReplay: 'session.turn.replay',
  ping: 'ping',
  agentList: 'agent.list',
} as const;

/** 下行控制消息（kind=system） */
export const SYSTEM_TYPE = {
  hello: 'hello',
  ack: 'ack',
  pong: 'pong',
  error: 'error',
  shutdown: 'shutdown',
  /** 历史响应与上行同名 */
  sessionHistory: 'session.history',
  /** 单轮回放响应与上行同名 */
  turnReplay: 'session.turn.replay',
} as const;

/** 下行流式事件（kind=agent，取值与 types.EventType 一致） */
export const AGENT_EVENT = {
  userMessageStart: 'user_message_start',
  userMessageCompleted: 'user_message_completed',
  reasoningStart: 'reasoning_start',
  reasoningDelta: 'reasoning_delta',
  reasoningCompleted: 'reasoning_completed',
  messageStart: 'message_start',
  messageDelta: 'message_delta',
  messageCompleted: 'message_completed',
  toolStart: 'tool_start',
  toolCompleted: 'tool_completed',
  error: 'error',
  approval: 'approval',
  finished: 'finished',
} as const;

/** 错误码（protocol/envelope.go 的 Code*） */
export const ERROR_CODE = {
  badRequest: 'bad_request',
  /** 鉴权失败：token 无效或缺失 */
  unauthorized: 'unauthorized',
  /** 越权访问其他用户的会话 */
  forbidden: 'forbidden',
  unsupported: 'unsupported',
  agentNotFound: 'agent_not_found',
  busy: 'busy',
  tooManyClients: 'too_many_clients',
  internal: 'internal',
} as const;

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 新建一条信封（默认划给 client 域，调用方通常只改 type/data） */
export function newEnvelope(env: {
  kind: string;
  type: string;
  sessionID?: string;
  chunk?: number;
  data?: unknown;
}): AgentEnvelope {
  const envelope: AgentEnvelope = {
    v: PROTOCOL_VERSION,
    id: uid(),
    kind: env.kind,
    type: env.type,
    ts: Date.now(),
  };
  if (env.sessionID) envelope.sessionID = env.sessionID;
  if (env.chunk !== undefined) {
    envelope.chunk = env.chunk;
    envelope.seq = env.chunk;
  }
  if (env.data !== undefined) envelope.data = env.data;
  return envelope;
}

/**
 * 从 sessionID 反解会话 key。
 *
 * 服务端会话键 = `{channel}_{userID}_{chatID}`（command.SessionKey）。
 * **channel 不是固定的**：真实后端是 `wxcom:work` 这类值，所以不能拼 `ws_` 前缀，
 * 而是用 userID 定位分隔符 `_<userID>_`，左边是 channel、右边就是 chatID ——
 * 这样 chatID 里带下划线也不会截错。
 *
 * 优先级：ack/历史里登记过的映射 → 按 userID 定位 → 兜底取最后一段。
 */
export function conversationIdOf(
  sessionID: string | undefined,
  sessions: Map<string, string>,
  identity?: { userId?: string },
): string {
  if (!sessionID) return '';

  const mapped = sessions.get(sessionID);
  if (mapped) return mapped;

  const userId = identity?.userId;
  if (userId) {
    const marker = `_${userId}_`;
    const index = sessionID.indexOf(marker);
    if (index >= 0) return sessionID.slice(index + marker.length);
  }

  // 兜底：chatID 由前端生成（conv- 前缀、不含下划线），取最后一段
  const parts = sessionID.split('_');
  return parts[parts.length - 1] ?? '';
}

/** 展示用：把字符串压成一行，超长截断（工具参数经常是 JSON 串） */
export function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
