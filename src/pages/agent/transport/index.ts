/**
 * 传输层出口。
 *
 * 配了 `VITE_AGENT_WS_URL` 就走 WebSocket，否则用本地演示实现 ——
 * 上层（chat/、页面）完全无感。
 *
 * 鉴权：服务端在 upgrade 前用 `Authenticator(token)` 解析出 userID / chatID，
 * 浏览器设不了请求头，所以 token 只能走 `?token=`。
 * 取值优先级：登录 token（与服务端同一套身份）> `VITE_AGENT_WS_TOKEN`。
 */

import { getToken } from '@/api/request';
import type { AgentTransport } from './types';
import { createMockTransport } from './mock';
import { createWebSocketTransport } from './websocket';
import type { TokenSource } from './websocket';

/** 当前可用的连接凭证（无 localStorage 的环境下要能安静退回 env 值） */
export function resolveAgentToken(): string | undefined {
  let loginToken: string | undefined;
  try {
    loginToken = getToken() ?? undefined;
  } catch {
    // SSR / 隐私模式等拿不到 localStorage 的场景：不因此中断连接
    loginToken = undefined;
  }
  return loginToken ?? import.meta.env.VITE_AGENT_WS_TOKEN ?? undefined;
}

/** 有 VITE_AGENT_WS_URL 就是真实连接，否则演示 */
export function agentTransportMode(url?: string): AgentTransport['kind'] {
  const target = url ?? import.meta.env.VITE_AGENT_WS_URL;
  return target ? 'websocket' : 'mock';
}

export function createAgentTransport(url?: string, token?: TokenSource): AgentTransport {
  const target = url ?? import.meta.env.VITE_AGENT_WS_URL;
  if (target) {
    // 默认传函数：每次（重）连都取最新 token，登录态刷新后不用重建 transport
    return createWebSocketTransport(target, token ?? (() => resolveAgentToken()));
  }
  return createMockTransport();
}

export type {
  AgentHello,
  AgentHistoryQuery,
  AgentReplayQuery,
  AgentSendPayload,
  AgentTransport,
} from './types';
export type { TokenSource } from './websocket';
