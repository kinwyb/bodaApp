/**
 * 界面常量（纯数据，不含 JSX）。
 */

import type { AgentConnectionStatus } from './types';

/**
 * 自动重连次数上限（不含首次连接）。
 *
 * 放在这里而不是 transport 里，是因为提示文案要报这个数：
 * 「已停止自动重连」必须说清「试了几次」，否则用户没法判断该不该再点一次。
 */
export const AGENT_MAX_AUTO_RETRY = 5;

/** 连接状态文案与颜色 */
export const CONNECTION_META: Record<AgentConnectionStatus, { text: string; color: string }> = {
  idle: { text: '未连接', color: 'default' },
  connecting: { text: '连接中', color: 'processing' },
  connected: { text: '已连接', color: 'success' },
  error: { text: '连接异常', color: 'error' },
  failed: { text: '连接失败', color: 'error' },
};

/**
 * 状态说明：让用户知道「现在发生了什么、要不要自己动手」。
 *
 * error 与 failed 必须说清区别：前者还在自动重试（等就行），后者已经停手（必须点重连）。
 */
export const CONNECTION_HINT: Record<AgentConnectionStatus, string> = {
  idle: '还没有连接到后端服务',
  connecting: '正在连接后端服务…',
  connected: '连接正常',
  error: `与后端服务的连接已断开，正在自动重试（最多 ${AGENT_MAX_AUTO_RETRY} 次，最长每 15 秒一次），恢复后会自动接上`,
  failed: `自动重连已停止：连续重试 ${AGENT_MAX_AUTO_RETRY} 次仍未连上后端服务，请检查服务是否启动后点击「重连」`,
};

/** 断开后可以手工点「重连」的状态（idle 从未连过、error 仍自动重试中、failed 已停止自动重试） */
export const RECONNECTABLE_STATUSES: AgentConnectionStatus[] = ['idle', 'error', 'failed'];

/** 拿不到 hello（没连服务端）时的 agent 兜底选项 */
export const FALLBACK_AGENT_OPTIONS = [{ value: 'boda-agent', label: 'boda-agent' }];

/** 参数抽屉里的默认值（纯界面，等后端约定后再接） */
export const DEFAULT_SYSTEM_PROMPT =
  '你是 bodaWay 车间管理系统的助手。回答要给出结论、依据和可执行的下一步，涉及数据时注明来源。';
