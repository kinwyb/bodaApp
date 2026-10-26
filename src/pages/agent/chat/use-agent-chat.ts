/**
 * Agent 对话状态（业务逻辑层）。
 *
 * 上游是 transport 产出的语义事件，下游是页面 ——
 * 这里不出现任何协议字段，也不 import 任何 antd / x 组件。
 *
 * 命名沿用项目约定：带 use 的才是 hook，纯函数不带 use。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  AgentConnectionStatus,
  AgentConversation,
  AgentInfo,
  AgentMessage,
} from '../types';
import type { AgentSendPayload } from '../transport';
import { agentTransportMode, createAgentTransport } from '../transport';
import { createInitialConversations } from '../mock/fixtures';
import type { AgentChatState } from './actions';
import { createConversation, nextMessageKey } from './actions';
import { chatReducer } from './reducer';

function createInitialState(): AgentChatState {
  // 演示模式给几条带内容的会话；真实模式只留一个空会话，
  // 等 hello 到了再「认领」服务端的当前对话（见下面的 adopted 逻辑），
  // 否则首页会混进演示数据、也看不到后端已经存在的历史。
  if (agentTransportMode() === 'mock') {
    const conversations = createInitialConversations();
    return { conversations, activeKey: conversations[0].key };
  }
  const conversation = createConversation();
  return { conversations: [conversation], activeKey: conversation.key };
}

export type AgentChatApi = {
  conversations: AgentConversation[];
  activeConversation: AgentConversation;
  activeKey: string;
  connection: AgentConnectionStatus;
  /** 当前用的传输方式：mock = 演示脚本，websocket = 已连后端 */
  mode: 'mock' | 'websocket';
  /** 当前会话是否有回答正在生成 */
  streaming: boolean;
  /** 当前会话是否还有更早的历史（决定要不要显示「加载更早」） */
  hasMore: boolean;
  /** 历史请求进行中 */
  historyLoading: boolean;
  /** 后端 hello 下发的 agent 列表 */
  agents: AgentInfo[];
  /** 当前连接的用户身份（token 解析而来），mock 下为 mock-user */
  userId: string;
  /** 服务端 hello 下发的当前对话（诊断用；本地会话 key 始终以本地为准） */
  serverChatId: string;
  /** 当前选中的 agent */
  agent: string;
  setAgent: (name: string) => void;
  /** 心跳往返延迟（毫秒），未连真实服务时为 undefined */
  latency?: number;
  /** 连接级错误（投不到具体会话的那些） */
  lastError: string;
  clearError: () => void;
  /** 手动重连（鉴权失败或断线后） */
  reconnect: () => void;
  switchConversation: (key: string) => void;
  createConversation: () => void;
  renameConversation: (key: string, label: string) => void;
  deleteConversation: (key: string) => void;
  clearMessages: () => void;
  loadMore: () => void;
  /** 拉某一轮的完整过程（历史被截断时用） */
  replayTurn: (turnId: string) => void;
  send: (text: string, attachments?: AgentMessage['attachments']) => void;
  abort: () => void;
  retry: (messageKey: string) => void;
};

export function useAgentChat(): AgentChatApi {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const [connection, setConnection] = useState<AgentConnectionStatus>('idle');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agent, setAgentState] = useState('');
  const [userId, setUserId] = useState('');
  const [serverChatId, setServerChatId] = useState('');
  const [latency, setLatency] = useState<number | undefined>(undefined);
  const [lastError, setLastError] = useState('');
  // 传输方式是构建期就能确定的（看有没有配 VITE_AGENT_WS_URL），不需要 state
  const mode = agentTransportMode();

  const transportRef = useRef<ReturnType<typeof createAgentTransport> | null>(null);
  /** 供事件回调/命令读取最新状态（事件回调只注册一次，不能闭包旧 state） */
  const stateRef = useRef(state);
  /** send / retry 要读当前 agent，但它们的 useCallback 依赖是空的 */
  const agentRef = useRef(agent);
  /** 是否已经认领过服务端的当前对话（只认一次） */
  const adoptedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    const transport = createAgentTransport();
    transportRef.current = transport;

    const offEvent = transport.onEvent((event) => {
      // conversationId 为空的是连接级错误
      if (!event.conversationId) {
        if (event.type === 'error') setLastError(event.message);
        return;
      }
      switch (event.type) {
        case 'reply-start':
          dispatch({
            type: 'replyStart',
            conversationKey: event.conversationId,
            messageKey: nextMessageKey('ai'),
          });
          break;
        case 'text':
          dispatch({
            type: 'appendText',
            conversationKey: event.conversationId,
            text: event.text,
            replace: event.replace,
            eventId: event.eventId,
          });
          break;
        case 'reasoning':
          dispatch({
            type: 'appendReasoning',
            conversationKey: event.conversationId,
            text: event.text,
            replace: event.replace,
            eventId: event.eventId,
          });
          break;
        case 'tool':
          dispatch({
            type: 'upsertStep',
            conversationKey: event.conversationId,
            step: event.step,
          });
          break;
        case 'approval':
          dispatch({
            type: 'setApproval',
            conversationKey: event.conversationId,
            approval: event.approval,
          });
          break;
        case 'media':
          dispatch({
            type: 'setMedia',
            conversationKey: event.conversationId,
            media: event.media,
          });
          break;
        case 'sources':
          dispatch({
            type: 'setSources',
            conversationKey: event.conversationId,
            sources: event.sources,
          });
          break;
        case 'history':
          dispatch({
            type: 'history',
            conversationKey: event.conversationId,
            threads: event.threads,
            frames: event.frames,
            framesTruncated: event.framesTruncated,
            mode: event.mode,
          });
          break;
        case 'replay':
          dispatch({
            type: 'replayTurn',
            conversationKey: event.conversationId,
            turnId: event.turnId,
            frames: event.frames,
            truncated: event.truncated,
          });
          break;
        case 'reply-done':
          dispatch({ type: 'finish', conversationKey: event.conversationId });
          break;
        case 'error':
          dispatch({ type: 'fail', conversationKey: event.conversationId, message: event.message });
          break;
        default:
          break;
      }
    });

    const offStatus = transport.onStatusChange(setConnection);
    const offLatency = transport.onLatency(setLatency);
    const offHello = transport.onHello((hello) => {
      setAgents(hello.agents);
      setAgentState((current) => current || hello.defaultAgent || hello.agents[0]?.name || '');
      setUserId(hello.userId);
      setServerChatId(hello.chatId);

      /*
       * 认领服务端的「当前对话」。
       *
       * hello.chatID 可能来自 token（续接别的端），也可能是服务端生成的；里面有历史时
       * 前端直接用它当会话 key 就能看到上次的对话。但只认一次、且只在「本地只有一个空会话」时认：
       * 否则重连会把多个本地会话都绑到同一个 chatID 上，历史就串了。
       */
      const { conversations } = stateRef.current;
      if (!adoptedRef.current && hello.chatId && conversations.length === 1) {
        const only = conversations[0];
        if (only.key !== hello.chatId && only.messages.length === 0) {
          adoptedRef.current = true;
          // 历史由下面的 connection effect 用新 key 去拉
          dispatch({ type: 'rebindConversation', fromKey: only.key, toKey: hello.chatId });
        }
      }
    });
    transport.connect();

    return () => {
      offEvent();
      offStatus();
      offLatency();
      offHello();
      transport.disconnect();
      transportRef.current = null;
    };
  }, []);

  const activeConversation = useMemo(() => {
    const found = state.conversations.find((conversation) => conversation.key === state.activeKey);
    return found ?? state.conversations[0];
  }, [state]);

  const streaming = useMemo(
    () => activeConversation.messages.some((message) => message.status === 'streaming'),
    [activeConversation],
  );

  /**
   * 连上之后把当前会话的历史补齐：
   * - 首次：mode=replace 拉全量（服务端顺便订阅该会话，重连后还能收实时事件）
   * - 重连：mode=append + since，只补断线期间落库的轮次
   */
  useEffect(() => {
    if (connection !== 'connected') return;
    const transport = transportRef.current;
    if (!transport) return;

    const { activeKey, conversations } = stateRef.current;
    const conversation = conversations.find((item) => item.key === activeKey);
    if (!conversation) return;

    if (!conversation.historyLoaded) {
      transport.history({ conversationId: activeKey, mode: 'replace' });
      return;
    }
    // 增量补发用 turn 的创建时间（不是消息的 completedAt），否则短时间内的轮次会漏
    const since =
      conversation.lastTurnAt ?? conversation.messages[conversation.messages.length - 1]?.createdAt;
    if (since) {
      transport.history({ conversationId: activeKey, since, mode: 'append' });
    }
  }, [connection]);

  /** 提交一条用户消息，同时插入一条空的助手消息等待流式填充 */
  const send = useCallback((text: string, attachments?: AgentMessage['attachments']) => {
    const question = text.trim();
    if (!question) return;

    const conversationKey = stateRef.current.activeKey;
    const createdAt = Date.now();
    const userMessage: AgentMessage = {
      key: nextMessageKey('user'),
      role: 'user',
      content: question,
      createdAt,
      status: 'done',
      attachments,
    };
    const replyMessage: AgentMessage = {
      key: nextMessageKey('ai'),
      role: 'assistant',
      content: { text: '' },
      createdAt: createdAt + 1,
      status: 'streaming',
    };

    dispatch({
      type: 'append',
      conversationKey,
      messages: [userMessage, replyMessage],
      autoLabel: question,
    });

    const payload: AgentSendPayload = {
      conversationId: conversationKey,
      content: question,
      agent: agentRef.current || undefined,
      attachments: attachments?.map((file) => ({ name: file.name, size: file.size })),
    };
    transportRef.current?.send(payload);
  }, []);

  const abort = useCallback(() => {
    const { activeKey, conversations } = stateRef.current;
    transportRef.current?.abort(activeKey);
    const conversation = conversations.find((item) => item.key === activeKey);
    if (conversation?.messages.some((message) => message.status === 'streaming')) {
      dispatch({ type: 'stop', conversationKey: activeKey });
    }
  }, []);

  /** 重跑某条助手回答：拿它前面最近的一条用户消息重新发一遍 */
  const retry = useCallback((messageKey: string) => {
    const { activeKey, conversations } = stateRef.current;
    const conversation = conversations.find((item) => item.key === activeKey);
    if (!conversation) return;

    const index = conversation.messages.findIndex((message) => message.key === messageKey);
    if (index < 0) return;

    const question = [...conversation.messages.slice(0, index)]
      .reverse()
      .find((message) => message.role === 'user');
    if (!question || typeof question.content !== 'string') return;

    dispatch({ type: 'resetReply', conversationKey: activeKey, messageKey });
    transportRef.current?.send({
      conversationId: activeKey,
      content: question.content,
      agent: agentRef.current || undefined,
    });
  }, []);

  const switchConversation = useCallback((key: string) => {
    dispatch({ type: 'switch', key });
    // 切到一个还没拉过历史的会话：顺手拉一次（服务端也会因此订阅该会话）
    const conversation = stateRef.current.conversations.find((item) => item.key === key);
    if (conversation && !conversation.historyLoaded) {
      transportRef.current?.history({ conversationId: key, mode: 'replace' });
    }
  }, []);

  /** 往上翻页：用当前最早一条的 seq 作为 beforeSeq */
  const loadMore = useCallback(() => {
    const { activeKey, conversations } = stateRef.current;
    const conversation = conversations.find((item) => item.key === activeKey);
    if (!conversation || conversation.historyLoading) return;
    if (!conversation.hasMore || conversation.oldestSeq === undefined) return;

    dispatch({ type: 'historyStart', conversationKey: activeKey });
    transportRef.current?.history({
      conversationId: activeKey,
      beforeSeq: conversation.oldestSeq,
      mode: 'prepend',
    });
  }, []);

  /**
   * 拉某一轮的完整过程（session.turn.replay）。
   *
   * 历史里带的过程帧会被服务端按条数/体积截断（framesTruncated），
   * 用户点「查看完整过程」时用这个接口换成不带截断的版本。
   */
  const replayTurn = useCallback((turnId: string) => {
    if (!turnId) return;
    transportRef.current?.replay({ conversationId: stateRef.current.activeKey, turnId });
  }, []);

  const handleCreate = useCallback(() => {
    dispatch({ type: 'create', conversation: createConversation() });
  }, []);

  const renameConversation = useCallback((key: string, label: string) => {
    dispatch({ type: 'rename', key, label });
  }, []);

  const deleteConversation = useCallback((key: string) => {
    dispatch({ type: 'remove', key });
  }, []);

  const clearMessages = useCallback(() => {
    dispatch({ type: 'clear', key: stateRef.current.activeKey });
  }, []);

  const clearError = useCallback(() => setLastError(''), []);

  /** 鉴权失败 / 断线后手动重连：重新读 token 再连一次 */
  const reconnect = useCallback(() => {
    setLastError('');
    transportRef.current?.connect();
  }, []);

  const setAgent = useCallback((name: string) => {
    setAgentState(name);
  }, []);

  return {
    conversations: state.conversations,
    activeConversation,
    activeKey: state.activeKey,
    connection,
    mode,
    streaming,
    hasMore: Boolean(activeConversation.hasMore),
    historyLoading: Boolean(activeConversation.historyLoading),
    agents,
    userId,
    serverChatId,
    agent,
    setAgent,
    latency,
    lastError,
    clearError,
    reconnect,
    switchConversation,
    createConversation: handleCreate,
    renameConversation,
    deleteConversation,
    clearMessages,
    loadMore,
    replayTurn,
    send,
    abort,
    retry,
  };
}
