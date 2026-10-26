/**
 * 演示用的界面数据：欢迎页快捷指令、能力卡片、初始会话列表。
 */

import type { AgentConversation, AgentToolStep } from '../types';
import { DELIVERY_SCRIPT } from './scripts';
import type { MockScript } from './scripts';

/** 欢迎页的快捷指令（图标在组件里按 key 映射，这里不放 JSX） */
export type AgentPrompt = {
  key: string;
  label: string;
  description: string;
};

export const AGENT_PROMPTS: AgentPrompt[] = [
  {
    key: 'delivery',
    label: '预订单交付风险',
    description: '找出本周可能延期的预订单，并说明原因',
  },
  {
    key: 'capacity',
    label: '产能瓶颈分析',
    description: '对比各车间的计划工时与可用工时',
  },
  {
    key: 'report',
    label: '生成生产日报',
    description: '汇总今日产量、异常与在制品数量',
  },
  {
    key: 'material',
    label: '物料齐套检查',
    description: '检查明天开工工单的缺料情况',
  },
];

/** 欢迎页与参数抽屉里展示的能力 */
export const AGENT_CAPABILITIES: AgentPrompt[] = [
  { key: 'sql', label: '数据查询', description: '自然语言转查询条件，直接落到现有表格视图' },
  { key: 'tool', label: '工具调用', description: '串接多条业务接口，结果带完整调用链' },
  { key: 'history', label: '历史会话', description: '按 session.history 拉回轮次，支持翻页与增量补发' },
];

/** 脚本里的工具调用 → 界面步骤（预置历史消息用） */
function stepsOf(script: MockScript): AgentToolStep[] {
  return script.tools.map((tool) => ({
    key: tool.id,
    title: tool.name,
    description: tool.params,
    status: 'success',
    content: tool.result,
  }));
}

/** 初始会话（每次调用返回新对象，避免被 reducer 直接改到常量） */
export function createInitialConversations(): AgentConversation[] {
  const now = Date.now();
  return [
    {
      key: 'conv-delivery',
      label: '预订单交付风险分析',
      group: '今天',
      updatedAt: now - 1000 * 60 * 41,
      messages: [
        {
          key: 'demo-user-1',
          role: 'user',
          content: '帮我看看本周预订单的交付风险，重点是有没有要延期的。',
          createdAt: now - 1000 * 60 * 42,
          status: 'done',
        },
        {
          key: 'demo-ai-1',
          role: 'assistant',
          content: {
            text: DELIVERY_SCRIPT.text,
            reasoning: DELIVERY_SCRIPT.reasoning,
            steps: stepsOf(DELIVERY_SCRIPT),
          },
          createdAt: now - 1000 * 60 * 41,
          status: 'done',
        },
      ],
    },
    {
      key: 'conv-capacity',
      label: '本周产能瓶颈',
      group: '今天',
      updatedAt: now - 1000 * 60 * 60 * 5,
      messages: [],
    },
    {
      // 这个会话演示「打开时从 session.history 拉回历史」
      key: 'conv-history',
      label: '物料齐套检查',
      group: '更早',
      updatedAt: now - 1000 * 60 * 60 * 30,
      messages: [],
    },
  ];
}
