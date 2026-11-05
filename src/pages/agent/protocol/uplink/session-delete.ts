/**
 * 上行命令：session.delete（软删除一个对话线程）。
 *
 * 服务端只给 thread 打删除标记，历史轮次与执行过程仍保留，
 * 后续 session.list / session.history 会按标记过滤掉。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { SessionDeleteData } from '../payloads';

export type SessionDeleteInput = {
  threadID: string;
};

export function buildSessionDelete(input: SessionDeleteInput): AgentEnvelope {
  const data: SessionDeleteData = {
    threadID: input.threadID,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.sessionDelete, data });
}
