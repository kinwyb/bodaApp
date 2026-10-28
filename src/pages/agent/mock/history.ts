/**
 * 演示用的历史消息（session.history 的响应内容）。
 *
 * 只有「物料齐套检查」这个会话有历史，用来验证「打开会话 → 拉历史 → 回填」这条链路；
 * 其它会话返回空数组，保持欢迎页。
 */

import type { AgentHistoryThread, AgentHistoryTurn, AgentTokenDetail } from '../types';

/** 演示用量：字段得齐全（界面按 0 归一，缺字段反而不像真数据） */
function detail(input: number, output: number, reasoning = 0): AgentTokenDetail {
  return {
    totalTokens: input + output,
    inputTokens: input,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
  };
}

/** 空明细：轮次级没有累计、线程级没有本轮，对应层留空 */
const EMPTY = detail(0, 0);

export function buildMockHistory(conversationId: string): AgentHistoryThread[] {
  if (conversationId !== 'conv-history') return [];

  const now = Date.now();
  const turns: AgentHistoryTurn[] = [
    {
      seq: 101,
      reqID: 'req-mock-101',
      threadID: 'thread-mock-material',
      turnID: 'turn-mock-101',
      agent: 'boda-agent',
      question: '检查明天开工工单的缺料情况。',
      answer: `明天开工 **12 个工单**，其中 **2 个缺料**：

| 工单 | 产品 | 缺料 | 缺口 |
| --- | --- | --- | --- |
| WO-20261027-004 | 液压阀体 | M8×25 螺栓 | 320 件 |
| WO-20261027-009 | 法兰盘 | 密封圈 φ45 | 80 件 |

其余 10 个工单物料齐套，可以正常开工。`,
      completed: true,
      createdAt: now - 1000 * 60 * 60 * 30,
      completedAt: now - 1000 * 60 * 60 * 30 + 12_000,
      // 轮次级只给「本轮」与上下文窗口（与真实接口一致，累计看线程级）
      usage: { total: EMPTY, last: detail(3_820, 460, 120), contextWindow: 200_000 },
    },
    {
      seq: 102,
      reqID: 'req-mock-102',
      threadID: 'thread-mock-material',
      turnID: 'turn-mock-102',
      agent: 'boda-agent',
      question: '那两张缺料单有替代料吗？',
      answer: `两张都有替代方案：

1. **M8×25 螺栓**：可用 M8×30（库存 1 200 件）代替，需要工艺确认 3 个工位的装配空间；
2. **密封圈 φ45**：无同规格替代，建议走急件采购，或在系统内改为外协加工。

> 替代料需要工艺工程师在「基础资料 → 替代料关系」里维护后才能直接下单。`,
      completed: true,
      createdAt: now - 1000 * 60 * 60 * 29,
      completedAt: now - 1000 * 60 * 60 * 29 + 9_000,
      usage: { total: EMPTY, last: detail(5_210, 520, 180), contextWindow: 200_000 },
    },
  ];

  return [
    {
      threadID: 'thread-mock-material',
      agent: 'boda-agent',
      createdAt: turns[0].createdAt,
      lastUpdate: turns[turns.length - 1].createdAt,
      turns,
      hasMore: false,
      // 线程级只有累计（界面算上下文占用时用最后一轮的 last）
      usage: { total: detail(9_030, 980, 300), last: EMPTY, contextWindow: 0 },
    },
  ];
}
