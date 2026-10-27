/**
 * WebSocket 传输实现。
 *
 * 只做四件事：连/断/重连、上行信封发送、下行信封路由、心跳与延迟。
 * 协议细节全在 protocol/ 里，这里不出现任何字段名魔法。
 */

import type { AgentConnectionStatus } from '../types';
import type { AgentEnvelope, HistoryMode, SessionHistoryResult, TurnReplayResult } from '../protocol';
import {
  SYSTEM_TYPE,
  UI_TYPE,
  buildChatCancel,
  buildChatSend,
  buildPing,
  buildSessionHistory,
  buildSessionList,
  buildTurnReplay,
  buildUIResponse,
  conversationIdOf,
  mapAgentEnvelope,
  mapEnvelopeAttachments,
  parseAck,
  parseError,
  parseHello,
  parseSessionList,
  parseUIRequest,
  toHistoryEvent,
  toReplayEvent,
} from '../protocol';
import type { AgentSessionPage, UIResponsePayload } from '../protocol';
import type { AgentHello, AgentTransport, AgentUIRequest } from './types';
import { installFrameTrace, traceIncoming, traceUplink } from './frame-trace';

/** 上行请求的类别：决定响应回来时用哪种方式解析 */
type PendingKind = 'chat' | 'history' | 'replay' | 'sessions';

/** 断线重连上限与退避上限 */
const MAX_RECONNECT = 5;
const MAX_BACKOFF = 15_000;
/** 握手成功前就被关闭、且耗时短于这个值 → 判定为鉴权/地址问题，不再重连 */
const HANDSHAKE_FAIL_WINDOW = 2_000;

/** token 可以是固定值，也可以是每次（重）连都求值的函数（接登录态刷新） */
export type TokenSource = string | (() => string | undefined);

export function createWebSocketTransport(url: string, token?: TokenSource): AgentTransport {
  if (import.meta.env.DEV) installFrameTrace();

  const eventListeners = new Set<(event: import('../protocol').AgentStreamEvent) => void>();
  const statusListeners = new Set<(status: AgentConnectionStatus) => void>();
  const helloListeners = new Set<(hello: AgentHello) => void>();
  const sessionListeners = new Set<(page: AgentSessionPage) => void>();
  const latencyListeners = new Set<(ms: number) => void>();
  const uiListeners = new Set<(request: AgentUIRequest) => void>();

  /** 上行信封 id → 请求上下文（ack / error / 历史 / 回放 靠 replyTo 找回） */
  const pending = new Map<string, { conversationId: string; kind: PendingKind; mode: HistoryMode }>();
  /** sessionID → 会话 key */
  const sessions = new Map<string, string>();

  let socket: WebSocket | null = null;
  let status: AgentConnectionStatus = 'idle';
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let manualClose = false;
  let pingSentAt = 0;
  /** 连接建立前排队的上行帧 */
  let pendingFrames: string[] = [];
  /** hello 是否已到（拿不到 hello 就被关，多半是鉴权失败） */
  let handshaked = false;
  /** 本次连接开始时间，用于识别「刚连上就被拒」 */
  let connectAt = 0;
  /** 鉴权失败只提示一次，避免重试时刷屏 */
  let authFailed = false;
  /** token 解析出的身份，用于把 sessionID 反解回会话（{channel}_{userId}_{chatId}） */
  let identity: { userId: string } = { userId: '' };

  const emit = (event: import('../protocol').AgentStreamEvent) => {
    eventListeners.forEach((listener) => listener(event));
  };

  const setStatus = (next: AgentConnectionStatus) => {
    status = next;
    statusListeners.forEach((listener) => listener(next));
  };

  const sessionIdOf = (conversationId: string): string | undefined =>
    [...sessions.entries()].find(([, conversation]) => conversation === conversationId)?.[0];

  const rawPost = (frame: string) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(frame);
    } else {
      pendingFrames.push(frame);
    }
  };

  /** 发送一条上行信封，并登记它属于哪个会话 */
  const postEnvelope = (
    envelope: AgentEnvelope,
    related?: { conversationId: string; kind?: PendingKind; mode?: HistoryMode },
  ) => {
    if (related) {
      pending.set(envelope.id, {
        conversationId: related.conversationId,
        kind: related.kind ?? 'chat',
        mode: related.mode ?? 'replace',
      });
    }
    rawPost(JSON.stringify(envelope));
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const startHeartbeat = (seconds: number) => {
    stopHeartbeat();
    const interval = Math.max(5, seconds || 30) * 1000;
    heartbeatTimer = setInterval(() => {
      pingSentAt = Date.now();
      rawPost(JSON.stringify(buildPing(pingSentAt)));
    }, interval);
  };

  /* ---------------- 下行路由 ---------------- */

  const handleSystem = (envelope: AgentEnvelope) => {
    switch (envelope.type) {
      case SYSTEM_TYPE.hello: {
        const hello = parseHello(envelope.data);
        handshaked = true;
        authFailed = false;
        // hello 里的 userID 是 token 解析出来的身份，会话键 = {channel}_<userId>_<chatId>
        identity = { userId: hello.userId };
        setStatus('connected');
        reconnectAttempt = 0;
        startHeartbeat(hello.heartbeat);
        helloListeners.forEach((listener) => listener(hello));
        break;
      }

      case SYSTEM_TYPE.ack: {
        const data = parseAck(envelope.data);
        const request = envelope.replyTo ? pending.get(envelope.replyTo) : undefined;
        if (request && data.sessionID) {
          // 登记后，下行 agent 事件靠 sessionID 就能定位会话
          sessions.set(data.sessionID, request.conversationId);
          // 告诉状态层「这条会话落库了」：草稿据此认领会话列表里的自己
          emit({
            type: 'session-bound',
            conversationId: request.conversationId,
            sessionId: data.sessionID,
          });
        }
        if (envelope.replyTo) pending.delete(envelope.replyTo);
        if (!data.ok && request) {
          emit({
            type: 'error',
            conversationId: request.conversationId,
            message: data.message || '请求未被受理',
          });
        }
        break;
      }

      case SYSTEM_TYPE.sessionList: {
        if (envelope.replyTo) pending.delete(envelope.replyTo);
        const page = parseSessionList(envelope.data);
        sessionListeners.forEach((listener) => listener(page));
        break;
      }

      case SYSTEM_TYPE.sessionHistory: {
        const result = (envelope.data ?? {}) as SessionHistoryResult;
        const request = envelope.replyTo ? pending.get(envelope.replyTo) : undefined;
        if (envelope.replyTo) pending.delete(envelope.replyTo);

        const conversationId =
          request?.conversationId ?? conversationIdOf(envelope.sessionID, sessions, identity);
        if (result.sessionID && conversationId) {
          sessions.set(result.sessionID, conversationId);
          emit({ type: 'session-bound', conversationId, sessionId: result.sessionID });
        }
        if (!conversationId) break;
        emit(toHistoryEvent(result, conversationId, request?.mode ?? 'replace'));
        break;
      }

      case SYSTEM_TYPE.turnReplay: {
        const result = (envelope.data ?? {}) as TurnReplayResult;
        const request = envelope.replyTo ? pending.get(envelope.replyTo) : undefined;
        if (envelope.replyTo) pending.delete(envelope.replyTo);

        const conversationId =
          request?.conversationId ?? conversationIdOf(envelope.sessionID, sessions, identity);
        if (result.sessionID && conversationId) {
          sessions.set(result.sessionID, conversationId);
        }
        if (!conversationId) break;
        emit(toReplayEvent(result, conversationId));
        break;
      }

      case SYSTEM_TYPE.pong: {
        if (pingSentAt > 0) {
          const elapsed = Date.now() - pingSentAt;
          pingSentAt = 0;
          latencyListeners.forEach((listener) => listener(elapsed));
        }
        break;
      }

      case SYSTEM_TYPE.error: {
        const data = parseError(envelope.data);
        const request = envelope.replyTo ? pending.get(envelope.replyTo) : undefined;
        if (envelope.replyTo) pending.delete(envelope.replyTo);
        emit({
          type: 'error',
          // 找不到归属会话时作为连接级错误
          conversationId: request?.conversationId ?? '',
          message: data.message,
        });
        break;
      }

      case SYSTEM_TYPE.shutdown: {
        manualClose = true;
        setStatus('idle');
        socket?.close();
        break;
      }

      default:
        break;
    }
  };

  /**
   * 下行 ui.request：服务端要页面快照，或要执行一条界面命令。
   *
   * 没人接的时候必须主动回一条错误：服务端在同步等待回执，不回答就是超时，
   * 模型只会看到「超时」而不知道为什么（页面没接入 ≠ 页面出错了）。
   */
  const handleUI = (envelope: AgentEnvelope) => {
    if (envelope.type !== UI_TYPE.request) return; // 未知 ui 类型按协议忽略
    const payload = parseUIRequest(envelope.data);
    if (!payload) return;

    const respond = (body: UIResponsePayload) => {
      const reply = buildUIResponse(body, { replyTo: envelope.id, sessionID: envelope.sessionID });
      // 答了多久：服务端此刻正卡在同步等待里，这段时间不会产生任何下行帧
      if (import.meta.env.DEV) traceUplink(reply);
      rawPost(JSON.stringify(reply));
    };

    if (uiListeners.size === 0) {
      respond({ ok: false, error: '当前页面没有接入界面桥，无法被操作' });
      return;
    }
    uiListeners.forEach((listener) =>
      listener({ id: envelope.id, sessionID: envelope.sessionID, payload, respond }),
    );
  };

  const handle = (envelope: AgentEnvelope) => {
    if (envelope.kind === 'system') {
      handleSystem(envelope);
      return;
    }
    if (envelope.kind === 'ui') {
      handleUI(envelope);
      return;
    }
    if (envelope.kind === 'agent') {
      const conversationId = conversationIdOf(envelope.sessionID, sessions, identity);
      if (!conversationId) return;
      mapAgentEnvelope(envelope, conversationId).forEach(emit);
      mapEnvelopeAttachments(envelope, conversationId).forEach(emit);
    }
    // 未知 kind（cron / notice / 后续扩展）按协议忽略
  };

  /* ---------------- 连接生命周期 ---------------- */

  const openSocket = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    setStatus('connecting');

    // token 每次都重新求值：登录态刷新 / 重新登录后重连能带上新凭证
    const rawToken = typeof token === 'function' ? token() : token;
    const target = rawToken
      ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(rawToken)}`
      : url;

    handshaked = false;
    connectAt = Date.now();

    const ws = new WebSocket(target);
    socket = ws;

    ws.onopen = () => {
      // 真正的 connected 等 hello：那里带 agent 列表、身份与心跳间隔
      pendingFrames.forEach((frame) => ws.send(frame));
      pendingFrames = [];
    };

    ws.onclose = () => {
      stopHeartbeat();
      socket = null;
      if (manualClose) {
        setStatus('idle');
        return;
      }
      setStatus('idle');

      // 鉴权在 upgrade 之前完成：token 无效时连接被直接拒绝，浏览器只给 onerror/onclose。
      // 这种「刚连上就被关且从未握手」的情况重连也没用，直接给出可读的错误。
      if (!handshaked && Date.now() - connectAt < HANDSHAKE_FAIL_WINDOW) {
        manualClose = true;
        setStatus('error');
        if (!authFailed) {
          authFailed = true;
          emit({
            type: 'error',
            conversationId: '',
            message: '连接被拒绝：鉴权失败或服务地址不可达（检查 token 与 VITE_AGENT_WS_URL）',
          });
        }
        return;
      }

      if (reconnectAttempt >= MAX_RECONNECT) {
        setStatus('error');
        return;
      }
      const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_BACKOFF);
      reconnectAttempt += 1;
      setStatus('connecting');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        openSocket();
      }, delay);
    };

    ws.onerror = () => {
      // onclose 紧随其后，重连统一在 onclose 里处理
      setStatus('error');
    };

    ws.onmessage = (frame: MessageEvent<string>) => {
      let envelope: AgentEnvelope;
      try {
        envelope = JSON.parse(frame.data) as AgentEnvelope;
      } catch {
        return;
      }
      // 开发期打点：到达 → 同步处理 → 下一次绘制，用来定位「帧到了但界面不动」
      if (import.meta.env.DEV) {
        traceIncoming(envelope, frame.data.length, () => handle(envelope));
        return;
      }
      handle(envelope);
    };
  };

  return {
    kind: 'websocket',

    connect() {
      manualClose = false;
      authFailed = false;
      openSocket();
    },

    disconnect() {
      manualClose = true;
      stopHeartbeat();
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      pendingFrames = [];
      const ws = socket;
      socket = null;
      ws?.close();
      setStatus('idle');
    },

    send(payload) {
      // 已知 sessionID 就不再传 chatID：列表里那条会话的本地 key 是 threadID，
      // 当成 chatID 传给服务端会被记成连接上下文，后续消息就串到别的对话上了
      const sessionID = payload.sessionId || sessionIdOf(payload.conversationId);
      postEnvelope(
        buildChatSend({
          chatID: sessionID ? undefined : payload.conversationId,
          sessionID,
          content: payload.content,
          agent: payload.agent,
          attachments: payload.attachments,
        }),
        { conversationId: payload.conversationId },
      );
    },

    history(query) {
      const sessionID = query.sessionId || sessionIdOf(query.conversationId);
      postEnvelope(
        buildSessionHistory({
          chatID: sessionID ? undefined : query.conversationId,
          sessionID,
          threadID: query.threadID,
          beforeSeq: query.beforeSeq,
          since: query.since,
          limit: query.limit,
          // 默认要过程帧：历史里才能显示思考与工具链
          includeFrames: query.includeFrames ?? true,
        }),
        { conversationId: query.conversationId, kind: 'history', mode: query.mode ?? 'replace' },
      );
    },

    replay(query) {
      const sessionID = query.sessionId || sessionIdOf(query.conversationId);
      postEnvelope(
        buildTurnReplay({
          chatID: sessionID ? undefined : query.conversationId,
          sessionID,
          turnID: query.turnId,
          afterSeq: query.afterSeq,
          limit: query.limit,
        }),
        { conversationId: query.conversationId, kind: 'replay' },
      );
    },

    sessions(query) {
      postEnvelope(buildSessionList(query), { conversationId: '', kind: 'sessions' });
    },

    abort(conversationId, sessionId) {
      const sessionID = sessionId || sessionIdOf(conversationId);
      postEnvelope(
        buildChatCancel({
          chatID: sessionID ? undefined : conversationId,
          sessionID,
        }),
      );
    },

    onEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },

    onStatusChange(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => {
        statusListeners.delete(listener);
      };
    },

    onHello(listener) {
      helloListeners.add(listener);
      return () => {
        helloListeners.delete(listener);
      };
    },

    onSessions(listener) {
      sessionListeners.add(listener);
      return () => {
        sessionListeners.delete(listener);
      };
    },

    onLatency(listener) {
      latencyListeners.add(listener);
      return () => {
        latencyListeners.delete(listener);
      };
    },

    onUIRequest(listener) {
      uiListeners.add(listener);
      return () => {
        uiListeners.delete(listener);
      };
    },
  };
}
