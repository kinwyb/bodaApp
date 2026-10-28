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

/**
 * 重连退避：1s → 2s → 4s → 8s → 15s（封顶），**一直重试，不设次数上限**。
 *
 * 不设上限是有意的：后端重启是最常见的断线原因，前端必须能自己连回去。
 * 一味重试的代价只是每 15 秒一条连接日志，而「停止重试」的代价是
 * 用户以为界面坏了、必须手动刷新 —— 后者严重得多。
 */
const MAX_BACKOFF = 15_000;
/** 连续失败达到这个次数就把状态亮成「连接异常」（重连按钮随之出现），后台仍然继续重试 */
const VISIBLE_FAIL_ATTEMPTS = 2;
/**
 * 握手成功前就被关闭、且耗时短于这个值 → 判定为「秒失败」。
 * 注意：浏览器在 upgrade 阶段不会告诉我们是 401 还是 ECONNREFUSED，
 * 所以这个值**只能用来决定提示文案，绝不能用来停止重连**。
 */
const HANDSHAKE_FAIL_WINDOW = 2_000;
/** 连续这么多个心跳周期都没收到 pong → 判定连接假死，主动断开触发重连 */
const MISSED_PONG_LIMIT = 2;

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
  /** 鉴权失败提示只发一次，避免每次重试都刷屏 */
  let authFailed = false;
  /** 连续「秒失败」次数：够 2 次才提示，避免一次网络抖动就吓人 */
  let quickFailCount = 0;
  /** 是否曾经握手成功过（区分「首连没起来」与「用着用着断了」） */
  let everConnected = false;
  /** 连续没收到 pong 的心跳轮数（假死检测） */
  let missedPongs = 0;
  /**
   * 本次连接是否真的收到过 pong。
   *
   * 假死检测只在「这条连接曾经回过 pong」时启用：万一服务端根本没实现 pong
   * （或实现有偏差），按「没有响应就断开」处理会变成每两个心跳周期断一次、
   * 无限重连 —— 那比原来的静默卡住严重得多。宁可测不准，也不要误杀。
   */
  let pongSeen = false;
  /** 页面可见性监听器的卸载函数（connect 时装、disconnect 时卸） */
  let detachVisibility: (() => void) | undefined;
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
    pingSentAt = 0;
    missedPongs = 0;
  };

  /**
   * 心跳：既测延迟，也负责发现「假死连接」。
   *
   * 后端进程被 kill -9、网线拔掉、机器休眠这几种情况，TCP 不会正常 FIN，
   * 浏览器的 onclose 可能几分钟都不触发，界面就一直停在「已连接」而实际收不到任何东西。
   * 所以这里数连着几个周期没有 pong —— 达到上限就主动 close，把控制权交回 onclose 的重连分支。
   */
  const startHeartbeat = (seconds: number) => {
    stopHeartbeat();
    const interval = Math.max(5, seconds || 30) * 1000;
    heartbeatTimer = setInterval(() => {
      if (pongSeen && pingSentAt > 0) {
        missedPongs += 1;
        if (missedPongs >= MISSED_PONG_LIMIT) {
          stopHeartbeat();
          // 主动断开：onclose 里 manualClose 仍是 false，会照常走重连
          socket?.close();
          return;
        }
      }
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
        quickFailCount = 0;
        missedPongs = 0;
        everConnected = true;
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
        // 收到任何 pong 都说明链路是活的（回过的连接才允许做假死判定）
        pongSeen = true;
        missedPongs = 0;
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

  /**
   * 页面长时间不可见时浏览器会把定时器节流到分钟级，退避重连可能迟迟不触发，
   * 用户切回来看到的就是「一直断线」。重新可见时立刻补一次连接尝试。
   */
  const installVisibilityWatch = () => {
    if (detachVisibility || typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (manualClose || status === 'connected') return;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      openSocket();
    };
    document.addEventListener('visibilitychange', onVisible);
    detachVisibility = () => {
      document.removeEventListener('visibilitychange', onVisible);
      detachVisibility = undefined;
    };
  };

  const openSocket = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    // error / connecting 状态保持不动：重试期间每失败一次就盖一次状态，
    // 顶栏的「连接异常」和重连按钮会跟着一直闪。只有从 idle 起来才需要点亮「连接中」。
    if (status === 'idle') setStatus('connecting');

    // token 每次都重新求值：登录态刷新 / 重新登录后重连能带上新凭证
    const rawToken = typeof token === 'function' ? token() : token;
    const target = rawToken
      ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(rawToken)}`
      : url;

    handshaked = false;
    pongSeen = false;
    connectAt = Date.now();

    const ws = new WebSocket(target);
    socket = ws;

    ws.onopen = () => {
      // 真正的 connected 等 hello：那里带 agent 列表、身份与心跳间隔
      pendingFrames.forEach((frame) => ws.send(frame));
      pendingFrames = [];
    };

    ws.onclose = () => {
      // 只认「当前这条」socket 的关闭：手动重连或假死自愈时会先关旧 socket，
      // 旧 socket 的 onclose 是异步到达的，若继续往下走会清掉新连接的心跳、
      // 并和新连接抢 socket。
      if (socket !== ws) return;
      stopHeartbeat();
      socket = null;
      if (manualClose) {
        setStatus('idle');
        return;
      }

      /*
       * 「刚连上就被关」= 快速失败。这种情况浏览器在 upgrade 阶段不区分
       * 401 和 ECONNREFUSED，两者表现完全一样（onerror + 立即 close）。
       * 所以它只能影响提示文案，**不能**用来决定是否继续重连 ——
       * 早期版本正是在这里 manualClose = true，导致后端一停就永久断线。
       */
      const quickFail = !handshaked && Date.now() - connectAt < HANDSHAKE_FAIL_WINDOW;
      quickFailCount = quickFail ? quickFailCount + 1 : 0;
      if (quickFailCount >= 2 && !authFailed) {
        authFailed = true;
        emit({
          type: 'error',
          conversationId: '',
          message: '无法连接服务：鉴权失败或后端未启动（检查 token 与 VITE_AGENT_WS_URL），正在自动重试',
        });
      }

      // 退避重试，永不停止：连上后 hello 会把 reconnectAttempt 归零
      reconnectAttempt += 1;
      const delay = Math.min(1000 * 2 ** (reconnectAttempt - 1), MAX_BACKOFF);
      /*
       * 什么时候把状态亮成「连接异常」（横幅与重连按钮据此出现）：
       * - 刚用着用着断了：第一次重试失败就亮，用户不该盯着「连接中」干等；
       * - 一进来就没连上：给 2 次机会（约 3 秒），避免服务启动慢一点就报错吓人。
       * 无论哪种，后台都继续重试 —— 状态只影响「让不让人看见」。
       */
      const failThreshold = everConnected ? 1 : VISIBLE_FAIL_ATTEMPTS;
      setStatus(reconnectAttempt >= failThreshold ? 'error' : 'connecting');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        openSocket();
      }, delay);
    };

    ws.onerror = () => {
      // onclose 总会紧随其后，状态与重连统一在 onclose 里处理。
      // 这里不要再 setStatus('error')：会先闪一下「连接异常」再被 onclose 覆盖。
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
      quickFailCount = 0;
      // 手动重连要重置计数：否则之前用尽的次数会让这次刚失败就直接判死
      reconnectAttempt = 0;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      // 可能连着一条假死/半开的连接：先摘掉再关，它的 onclose 会被 socket !== ws 挡掉
      const stale = socket;
      socket = null;
      stale?.close();

      installVisibilityWatch();
      setStatus('connecting');
      openSocket();
    },

    disconnect() {
      manualClose = true;
      stopHeartbeat();
      detachVisibility?.();
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
