/**
 * 演示实现：本地按同一套协议构造信封，再走一遍真实的解析路径。
 *
 * 这样「演示模式验证过的行为」和接上服务端后完全一致，
 * 不会出现「mock 能跑、真机不行」的假象。
 */

import type { AgentInfo, AgentSkill } from '../types';
import type { AgentEventData, AgentEnvelope, AgentSkillList, AgentStreamEvent } from '../protocol';
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
import { isSteerMessage } from '../commands';
import type { AgentHello, AgentTransport, AgentUIRequest } from './types';

/** 演示用的 agent 列表（结构与 hello 下发的 AgentInfo 一致） */
const MOCK_AGENTS: AgentInfo[] = [
  { name: 'boda-agent', description: '通用助手：查询、分析、生成' },
  { name: 'boda-sql', description: '只做数据查询与表格操作' },
];

const MOCK_SKILLS: Record<string, AgentSkill[]> = {
  'boda-agent': [
    {
      name: 'ui-operation',
      displayName: 'UI 操作',
      description: '观察页面、取数据并执行界面命令',
      shortDescription: '观察页面并执行界面命令',
      path: '/root/.codex/skills/ui-operation/SKILL.md',
      scope: 'user',
    },
    {
      name: 'order-progress-analysis',
      displayName: '订单进度分析',
      description: '查询并分析生产系统中的订单进度信息，识别生产隐患和异常',
      shortDescription: '查询订单进度与交期风险',
      path: '/root/.codex/skills/order-progress-analysis/SKILL.md',
      scope: 'user',
    },
  ],
  'boda-sql': [
    {
      name: 'ui-operation',
      displayName: 'UI 操作',
      description: '观察页面、取数据并执行界面命令',
      path: '/root/.codex/skills/ui-operation/SKILL.md',
      scope: 'user',
    },
  ],
};

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
  const sessionListeners = new Set<(page: import('../protocol').AgentSessionPage) => void>();
  const skillListeners = new Set<(result: AgentSkillList) => void>();
  const latencyListeners = new Set<(ms: number) => void>();
  const uiListeners = new Set<(request: AgentUIRequest) => void>();

  let status: import('../types').AgentConnectionStatus = 'idle';
  let cancelled = false;
  /** 演示审批阻塞点：play 推到审批帧后挂起，等 approve() 送来决定再继续 */
  let approvalResolve: ((decision: 'accept' | 'decline') => void) | null = null;
  /** 演示提问阻塞点：play 推到提问帧后挂起，等 answerUserInput() 送来答案再继续 */
  let userInputResolve: ((answers: Record<string, string[]>) => void) | null = null;
  /** 演示用的累计用量（真实后端由 DB 落库，这里按文本长度估） */
  let usedInput = 0;
  let usedOutput = 0;

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
    /** 审批决定会改写最终正文（允许 → 继续执行；拒绝 → 说明已停止） */
    let finalText = script.text;

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
      mapEnvelopeAttachments(envelope, payload.conversationId, {
        origin: 'live',
        includeSendFile: true,
        includeUserMedia: false,
      }).forEach(emit);
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
      // type / extra.server 与后端保持一致，MCP 工具才能在界面上带出来源标记
      const type = tool.type ?? 'function';
      const extra = tool.server ? { server: tool.server } : undefined;
      push(AGENT_EVENT.toolStart, {
        event: AGENT_EVENT.toolStart,
        role: 'assistant',
        toolCalls: [
          {
            id: tool.id,
            type,
            name: tool.name,
            params: tool.params,
            result: '',
            extra: extra ? { ...extra, status: 'inProgress' } : undefined,
          },
        ],
      });
      await sleep(520);
      if (cancelled) return;
      push(AGENT_EVENT.toolCompleted, {
        event: AGENT_EVENT.toolCompleted,
        role: 'tool',
        toolCalls: [
          {
            id: tool.id,
            type,
            name: tool.name,
            params: tool.params,
            result: tool.result,
            extra: extra ? { ...extra, status: 'completed', success: true } : undefined,
          },
        ],
      });
      await sleep(160);
    }

    // 审批演示：推一帧 approval 后阻塞这一轮，等用户在弹窗里点「允许 / 拒绝」。
    // 与真实后端一致 —— agent 被审批卡住，不回应就不会有后续帧。
    if (script.approval) {
      if (cancelled) return;
      const approvalId = `mock-approval-${Date.now().toString(36)}`;
      push(AGENT_EVENT.approval, {
        event: AGENT_EVENT.approval,
        role: 'system',
        delta: false,
        approval: {
          id: approvalId,
          content: script.approval.content,
          extra: {
            command: script.approval.command,
            cwd: script.approval.cwd,
            reason: script.approval.reason,
            method: 'execCommandApproval',
          },
        },
      });
      const decision = await new Promise<'accept' | 'decline'>((resolve) => {
        approvalResolve = resolve;
      });
      approvalResolve = null;
      if (cancelled) return;
      finalText = decision === 'accept' ? script.approval.acceptText : script.approval.declineText;
    }

    // 提问演示：推一帧 user_input 后阻塞这一轮，等用户作答 / 跳过。
    // 与真实后端一致 —— agent 被提问卡住，不作答就不会有后续帧。
    if (script.userInput) {
      if (cancelled) return;
      const requestId = `mock-user-input-${Date.now().toString(36)}`;
      push(AGENT_EVENT.userInput, {
        event: AGENT_EVENT.userInput,
        role: 'system',
        delta: false,
        userInput: {
          id: requestId,
          questions: script.userInput.questions,
          autoResolutionMs: script.userInput.autoResolutionMs,
        },
      });
      const answers = await new Promise<Record<string, string[]>>((resolve) => {
        userInputResolve = resolve;
      });
      userInputResolve = null;
      if (cancelled) return;
      // 上游落定后会发 serverRequest/resolved，这里走同一条解析路径
      push(AGENT_EVENT.requestResolved, { event: AGENT_EVENT.requestResolved }, requestId);
      const answered = Object.keys(answers).length > 0;
      if (answered) {
        const summary = Object.values(answers).flat().join('、');
        finalText = `已收到你的回答：${summary}。\n\n${script.userInput.answeredText}`;
      } else {
        finalText = script.userInput.skippedText;
      }
    }

    if (cancelled) return;
    push(AGENT_EVENT.messageStart, { event: AGENT_EVENT.messageStart, role: 'assistant' }, 'mock-message-0');

    for (const piece of splitText(finalText, 4)) {
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
      { event: AGENT_EVENT.messageCompleted, role: 'assistant', content: finalText, delta: false },
      'mock-message-0',
    );

    /*
     * token 用量：真实后端在每次模型调用后推一帧，这里按文本长度估一个量级。
     * 走的是同一条 mapAgentEnvelope 路径，所以能验证「用量只更新面板、不拼正文」。
     */
    const lastInput = Math.round((payload.content.length + 420) * 2.4);
    const lastOutput = Math.round(finalText.length * 1.7);
    usedInput += lastInput;
    usedOutput += lastOutput;
    const detail = (input: number, output: number) => ({
      totalTokens: input + output,
      inputTokens: input,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: output,
      reasoningOutputTokens: Math.round(output * 0.2),
    });
    push(AGENT_EVENT.tokenUsage, {
      event: AGENT_EVENT.tokenUsage,
      role: 'assistant',
      delta: false,
      usage: {
        total: detail(usedInput, usedOutput),
        last: detail(lastInput, lastOutput),
        modelContextWindow: 200_000,
      },
    });

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
      // 引导不会启动新一轮演示脚本；当前回答继续流式输出。
      if (isSteerMessage(payload.content)) return;
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

    sessions() {
      // 演示模式没有落库的会话：给个空列表，界面只显示当前的草稿
      setTimeout(() => {
        sessionListeners.forEach((listener) => listener({ items: [], hasMore: false }));
      }, 120);
    },

    skills(agent) {
      const target = agent || MOCK_AGENTS[0].name;
      setTimeout(() => {
        skillListeners.forEach((listener) =>
          listener({ agent: target, skills: MOCK_SKILLS[target] ?? [] }),
        );
      }, 120);
    },

    deleteSession(query) {
      // 演示模式没有真实落库数据，走一遍与真实响应相同的语义事件。
      setTimeout(() => {
        emit({
          type: 'session-deleted',
          conversationId: query.conversationId,
          threadId: query.threadId,
        });
      }, 120);
    },

    abort() {
      cancelled = true;
      // 审批挂起时中断：放行一个「拒绝」让 play 能退出，而不是永远卡在 await
      if (approvalResolve) {
        const resolve = approvalResolve;
        approvalResolve = null;
        resolve('decline');
      }
      // 提问挂起时中断：放行一次「跳过」让 play 能退出
      if (userInputResolve) {
        const resolve = userInputResolve;
        userInputResolve = null;
        resolve({});
      }
    },

    approve(query) {
      // 决定已由状态层乐观地记进时间线；这里只负责把阻塞的演示轮放行。
      if (approvalResolve) {
        const resolve = approvalResolve;
        approvalResolve = null;
        resolve(query.decision);
      }
    },

    answerUserInput(query) {
      // 答案已由状态层乐观地记进时间线；这里只负责把阻塞的演示轮放行。
      if (userInputResolve) {
        const resolve = userInputResolve;
        userInputResolve = null;
        resolve(query.answers);
      }
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

    onSkills(listener) {
      skillListeners.add(listener);
      return () => {
        skillListeners.delete(listener);
      };
    },

    onLatency(listener) {
      latencyListeners.add(listener);
      return () => {
        latencyListeners.delete(listener);
      };
    },

    /**
     * 演示模式没有服务端来问界面操作，保留订阅接口只为让上层代码不区分传输实现。
     */
    onUIRequest(listener) {
      uiListeners.add(listener);
      return () => {
        uiListeners.delete(listener);
      };
    },
  };
}
