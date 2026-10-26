/**
 * 上行命令：chat.send（发送用户消息）。
 *
 * 对应 protocol.ChatSendData。服务端会在投递后回 `system/ack`（带 sessionID），
 * 并把这之后的事件推给订阅了该 session 的连接。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { ChatSendData } from '../payloads';

export type ChatSendInput = {
  /**
   * 后端 chatID（前端会话 key）。只有「会话还没落库」时才需要 ——
   * 已有 sessionID 的会话不要传，服务端会用 chatID 建连接上下文，传错会串到别的对话。
   */
  chatID?: string;
  content: string;
  /** 指定 agent，为空用服务端默认 */
  agent?: string;
  /** 附件目前只把名字带给服务端（上传通道待定） */
  attachments?: { name: string; size: number }[];
  /** 已知 sessionID 时回传，便于服务端续接同一会话 */
  sessionID?: string;
};

export function buildChatSend(input: ChatSendInput): AgentEnvelope {
  const data: ChatSendData = {
    sessionID: input.sessionID || undefined,
    chatID: input.chatID || undefined,
    agent: input.agent || undefined,
    content: input.content,
    metadata: input.attachments?.length ? { attachments: input.attachments } : undefined,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.chatSend, data });
}
