/**
 * 演示实现：本地按同一套协议构造信封，再走一遍真实的解析路径。
 *
 * 这样「演示模式验证过的行为」和接上服务端后完全一致，
 * 不会出现「mock 能跑、真机不行」的假象。
 */

import type { AgentInfo } from '../types';
import type { AgentEventData, AgentEnvelope, AgentStreamEvent } from '../protocol';
import {
  AGENT_EVENT,
  KIND,
  SYSTEM_TYPE,
  mapAgentEnvelope,
  mapEnvelopeAttachments,
  newEnvelope,
  parseHello,
} from '../protocol';
import { buildMockHistory } from '../mock/history';
import { buildMockScript } from '../mock/scripts';
import { sleep, splitText } from '../mock/util';
import type { AgentHello, AgentTransport } from './types';

/** 演示用的 agent 列表（结构与 hello 下发的 AgentInfo 一致） */
const MOCK_AGENTS: AgentInfo[] = [
  { name: 'boda-agent', description: '通用助手：查询、分析、生成' },
  { name: 'boda-sql', description: '只做数据查询与表格操作' },
];

/** 演示用的身份 */
const MOCK_USER_ID = 'mock-user';
/**
 * 会话键里的渠道段由服务端配置，**不是固定值**（真实后端是 `wxcom:work` 这类），
 * 这里故意用一个带冒号的值，顺便验证前端没有写死 `ws_` 前缀。
 */
const MOCK_CHANNEL = 'mock:channel';

const MOCK_HELLO_DATA = {
  clientID: 'mock-client',
  userID: MOCK_USER_ID,
  // 留空表示「服务端沿用前端传的 chatID」，前端不会触发会话认领
  chatID: '',
  protocol: 1,
  agents: MOCK_AGENTS,
  defaultAgent: MOCK_AGENTS[0].name,
  heartbeat: 30,
};

export function createMockTransport(): AgentTransport {
  const eventListeners = new Set<(event: AgentStreamEvent) => void>();
  const statusListeners = new Set<(status: import('../types').AgentConnectionStatus) => void>();
  const helloListeners = new Set<(hello: AgentHello) => void>();
  const latencyListeners = new Set<(ms: number) => void>();

  let status: import('../types').AgentConnectionStatus = 'idle';
  let cancelled = false;

  const emit = (event: AgentStreamEvent) => {
    eventListeners.forEach((listener) => listener(event));
  };

  const setStatus = (next: import('../types').AgentConnectionStatus) => {
    status = next;
    statusListeners.forEach((listener) => listener(next));
  };

  /** 走一遍「构造信封 → 解析」的完整链路 */
  const play = async (payload: { conversationId: string; content: string }) => {
    cancelled = false;
    // 与 command.SessionKey 一致：{channel}_{userID}_{chatID}
    const sessionID = `${MOCK_CHANNEL}_${MOCK_USER_ID}_${payload.conversationId}`;
    const script = buildMockScript(payload.content);
    let chunk = 0;

    const push = (eventName: string, data: AgentEventData, eventId?: string) => {
      const envelope: AgentEnvelope = newEnvelope({
        kind: KIND.agent,
        type: eventName,
        sessionID,
        chunk,
        data,
      });
      // 与真实后端一致：同一实体的 start/delta/completed 共享 eventID
      if (eventId) envelope.eventID = eventId;
      chunk += 1;
      mapAgentEnvelope(envelope, payload.conversationId).forEach(emit);
      mapEnvelopeAttachments(envelope, payload.conversationId).forEach(emit);
    };

    // 模拟一次握手后的首帧延迟
    await sleep(160);
    if (cancelled) return;

    if (script.reasoning) {
      const pieces = splitText(script.reasoning, 14);
      for (let index = 0; index < pieces.length; index += 1) {
        if (cancelled) return;
        const isFirst = index === 0;
        push(isFirst ? AGENT_EVENT.reasoningStart : AGENT_EVENT.reasoningDelta, {
          event: isFirst ? AGENT_EVENT.reasoningStart : AGENT_EVENT.reasoningDelta,
          role: 'assistant',
          reasoning: pieces[index],
          delta: !isFirst,
        }, 'mock-reasoning-0');
        await sleep(36);
      }
      if (cancelled) return;
      push(AGENT_EVENT.reasoningCompleted, { event: AGENT_EVENT.reasoningCompleted, role: 'assistant' }, 'mock-reasoning-0');
    }

    // 工具：先 tool_start（loading），再 tool_completed（带结果）
    for (const tool of script.tools) {
      if (cancelled) return;
      push(AGENT_EVENT.toolStart, {
        event: AGENT_EVENT.toolStart,
        role: 'assistant',
        toolCalls: [{ id: tool.id, type: 'function', name: tool.name, params: tool.params, result: '' }],
      });
      await sleep(520);
      if (cancelled) return;
      push(AGENT_EVENT.toolCompleted, {
        event: AGENT_EVENT.toolCompleted,
        role: 'tool',
        toolCalls: [
          { id: tool.id, type: 'function', name: tool.name, params: tool.params, result: tool.result },
        ],
      });
      await sleep(160);
    }

    if (cancelled) return;
    push(AGENT_EVENT.messageStart, { event: AGENT_EVENT.messageStart, role: 'assistant' }, 'mock-message-0');

    for (const piece of splitText(script.text, 4)) {
      if (cancelled) return;
      push(
        AGENT_EVENT.messageDelta,
        {
          event: AGENT_EVENT.messageDelta,
          role: 'assistant',
          content: piece,
          delta: true,
        },
        'mock-message-0',
      );
      await sleep(24);
    }

    if (cancelled) return;
    // 完成帧带全量内容（与真实后端一致：completed 是收敛用的全量快照）
    push(
      AGENT_EVENT.messageCompleted,
      { event: AGENT_EVENT.messageCompleted, role: 'assistant', content: script.text, delta: false },
      'mock-message-0',
    );
    push(AGENT_EVENT.finished, { event: AGENT_EVENT.finished });
  };

  return {
    kind: 'mock',

    connect() {
      setStatus('connecting');
      // 模拟握手：真实服务端升级成功后立即下发 hello
      setTimeout(() => {
        if (status === 'idle') return;
        setStatus('connected');
        const envelope = newEnvelope({ kind: KIND.system, type: SYSTEM_TYPE.hello, data: MOCK_HELLO_DATA });
        const hello = parseHello(envelope.data);
        helloListeners.forEach((listener) => listener(hello));
      }, 300);
    },

    disconnect() {
      cancelled = true;
      setStatus('idle');
    },

    send(payload) {
      void play(payload);
    },

    history(query) {
      setTimeout(() => {
        emit({
          type: 'history',
          conversationId: query.conversationId,
          threads: buildMockHistory(query.conversationId),
          // 演示数据没有落库帧，直接走 turns 的摘要渲染
          frames: [],
          framesTruncated: false,
          mode: query.mode ?? 'replace',
        });
      }, 240);
    },

    replay(query) {
      setTimeout(() => {
        emit({
          type: 'replay',
          conversationId: query.conversationId,
          turnId: query.turnId,
          frames: [],
          hasMore: false,
          truncated: false,
        });
      }, 200);
    },

    abort() {
      cancelled = true;
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

    onLatency(listener) {
      latencyListeners.add(listener);
      return () => {
        latencyListeners.delete(listener);
      };
    },
  };
}
