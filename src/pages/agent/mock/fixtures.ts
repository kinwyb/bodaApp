/**
 * 演示用的界面数据：欢迎页快捷指令、能力卡片、初始会话列表。
 */

import type {AgentConversation, AgentToolStep} from '../types';
import type {MockScript} from './scripts';
import {DELIVERY_SCRIPT} from './scripts';

/** 欢迎页的快捷指令（图标在组件里按 key 映射，这里不放 JSX） */
export type AgentPrompt = {
    key: string;
    label: string;
    description: string;
    /**
     * 点击后填充进输入框的完整指令，可带 $技能 / 命令前缀，卡片上不展示；
     * 留空则退回 description。
     */
    prompt?: string;
    /**
     * 图标名（schedule / bar-chart / line-chart / pie-chart / file-text /
     * database / alert / tool / check / clock / search，见 PromptIcon）；
     * 留空按 key 映射，再落到默认文档图标。
     */
    icon?: string;
};

export const AGENT_PROMPTS: AgentPrompt[] = [
    {
        key: 'delivery',
        label: '预订单情况',
        description: '找出最近一周的预订单数据进行分析统计',
        prompt: '$ui-operation 打开预订单管理界面,筛选出预排日期是近一周的预订单情况统计分析数据'
    },
    {
        key: 'capacity',
        label: '订单生产进度分析',
        description: '分析订单生产进度,需要提供订单号',
        prompt: '$order-progress-analysis 分析订单生产进度,订单号是:',
    },
    {
        key: 'report',
        label: '生产效率分析',
        description: '分析近一周的生产效率',
        prompt: '$order-progress-analysis 分析近一周的生产效率情况',
    },
    // {
    //     key: 'material',
    //     label: '物料齐套检查',
    //     description: '检查明天开工工单的缺料情况',
    // },
];

/** 欢迎页与参数抽屉里展示的能力 */
export const AGENT_CAPABILITIES: AgentPrompt[] = [
    {key: 'sql', label: '界面操作', description: '自然语言描述操作系统界面功能，直接展示结果用于人机互动'},
    {key: 'tool', label: '工具调用', description: '串接多条业务接口，结果带完整调用链'},
    {key: 'history', label: '历史会话', description: '按 session.history 拉回轮次，支持翻页与增量补发'},
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
