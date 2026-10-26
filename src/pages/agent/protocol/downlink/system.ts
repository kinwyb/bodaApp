/**
 * 下行控制消息（kind=system）的解析。
 *
 * 这里只做「报文 → 结构」，带副作用的动作（起心跳、登记会话、关闭连接）
 * 由 transport/websocket.ts 负责。
 */

import type { AgentInfo } from '../../types';
import type { AckData, ErrorBody, PongData } from '../payloads';
import type { HelloData } from '../payloads';

/** hello 归一化后的结构（字段都有兜底值） */
export type HelloInfo = {
  clientID: string;
  /** 当前连接的用户身份（token 解析而来），会话键 = {channel}_<userId>_<chatId> */
  userId: string;
  /** 服务端确定的当前对话，可能来自 token 或服务端生成 */
  chatId: string;
  protocol: number;
  agents: AgentInfo[];
  defaultAgent: string;
  /** 心跳间隔（秒） */
  heartbeat: number;
};

export function parseHello(data: unknown): HelloInfo {
  const raw = (data ?? {}) as HelloData;
  return {
    clientID: raw.clientID ?? '',
    userId: raw.userID ?? '',
    chatId: raw.chatID ?? '',
    protocol: raw.protocol ?? 1,
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    defaultAgent: raw.defaultAgent ?? '',
    heartbeat: raw.heartbeat ?? 30,
  };
}

export function parseAck(data: unknown): Required<Pick<AckData, 'ok'>> & AckData {
  const raw = (data ?? {}) as AckData;
  return { ...raw, ok: raw.ok !== false };
}

export function parsePong(data: unknown): PongData {
  return (data ?? {}) as PongData;
}

export function parseError(data: unknown): Required<Pick<ErrorBody, 'message'>> & ErrorBody {
  const raw = (data ?? {}) as ErrorBody;
  return { ...raw, message: raw.message || '服务端返回错误' };
}
