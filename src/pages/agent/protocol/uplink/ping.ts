/**
 * 上行命令：ping（应用层心跳）。
 *
 * 服务端回 `system/pong`，带 clientTS / serverTS，前端据此算往返延迟。
 * 间隔取 hello 下发的 heartbeat，未拿到时用 30s。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';

export function buildPing(ts: number): AgentEnvelope {
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.ping, data: { ts } });
}
