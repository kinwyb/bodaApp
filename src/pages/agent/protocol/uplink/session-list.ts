/**
 * 上行命令：session.list（拉取对话列表）。
 *
 * 服务端按 thread 分组返回：一个 thread 就是一次完整对话，其下挂多轮 turn；
 * 同一会话换过 agent 会新建 thread，因此列表里表现为多条对话。
 *
 * 响应是 kind=system / type=session.list，靠 replyTo 与本次请求关联。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { SessionListData } from '../payloads';

export type SessionListInput = {
  /** 返回条数：0 用默认 50，负数取全量（上限 200） */
  limit?: number;
  /** 翻页游标：只取最后更新时间早于该时刻（毫秒）的对话 */
  beforeLastUpdate?: number;
  /** 与 beforeLastUpdate 组成复合游标 */
  beforeThreadID?: string;
};

export function buildSessionList(input: SessionListInput = {}): AgentEnvelope {
  const data: SessionListData = {
    limit: input.limit ?? undefined,
    beforeLastUpdate: input.beforeLastUpdate ?? undefined,
    beforeThreadID: input.beforeThreadID || undefined,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.sessionList, data });
}
