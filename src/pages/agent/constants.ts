/**
 * 界面常量（纯数据，不含 JSX）。
 */

import type { AgentConnectionStatus } from './types';

/** 连接状态文案与颜色 */
export const CONNECTION_META: Record<AgentConnectionStatus, { text: string; color: string }> = {
  idle: { text: '未连接', color: 'default' },
  connecting: { text: '连接中', color: 'processing' },
  connected: { text: '已连接', color: 'success' },
  error: { text: '连接异常', color: 'error' },
};

/**
 * 状态说明：让用户知道「现在发生了什么、要不要自己动手」。
 * 断开后前端一直自动重试（最长 15 秒一次），刷新页面并不是必需的。
 */
export const CONNECTION_HINT: Record<AgentConnectionStatus, string> = {
  idle: '还没有连接到后端服务',
  connecting: '正在连接后端服务…',
  connected: '连接正常',
  error: '与后端服务的连接已断开，正在自动重试（最多每 15 秒一次），恢复后会自动接上',
};

/** 拿不到 hello（没连服务端）时的 agent 兜底选项 */
export const FALLBACK_AGENT_OPTIONS = [{ value: 'boda-agent', label: 'boda-agent' }];

/** 参数抽屉里的默认值（纯界面，等后端约定后再接） */
export const DEFAULT_SYSTEM_PROMPT =
  '你是 bodaWay 车间管理系统的助手。回答要给出结论、依据和可执行的下一步，涉及数据时注明来源。';
