/**
 * 上行命令：chat.send（发送用户消息）。
 *
 * 对应 protocol.ChatSendData。服务端会在投递后回 `system/ack`（带 sessionID），
 * 并把这之后的事件推给订阅了该 session 的连接。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { ChatSendData } from '../payloads';
import type { AppLocale } from '@/i18n';
import { buildChatSendMetadata, type ChatSendAttachment } from './chat-send-metadata';

export type ChatSendInput = {
  /**
   * 后端 chatID（前端会话 key）。只有「会话还没落库」时才需要 ——
   * 已有 sessionID 的会话不要传，服务端会用 chatID 建连接上下文，传错会串到别的对话。
   */
  chatID?: string;
  content: string;
  /** 指定 agent，为空用服务端默认 */
  agent?: string;
  /**
   * 已上传文件的 fileID（上传走 HTTP，见 files/client.ts）。
   *
   * 服务端会取出真实路径与文件名拼成 media 投递，帧里只多几十字节的引用 ——
   * 比内联 base64 撞 1MB 单帧上限要稳，也不会因为大文件把 ws 拖死。
   */
  fileIds?: string[];
  /** 附件名字/大小：只进 metadata，服务端当元数据透传（演示模式下是唯一的附件信息） */
  attachments?: ChatSendAttachment[];
  /** 已知 sessionID 时回传，便于服务端续接同一会话 */
  sessionID?: string;
  /** 已知 threadID 时回传，服务端会直接在该历史对话下开始新轮次 */
  threadId?: string;
  /** 本轮发送时的界面语言；服务端据此约束默认回复语言 */
  locale: AppLocale;
};

export function buildChatSend(input: ChatSendInput): AgentEnvelope {
  const data: ChatSendData = {
    sessionID: input.sessionID || undefined,
    chatID: input.chatID || undefined,
    threadID: input.threadId || undefined,
    agent: input.agent || undefined,
    content: input.content,
    fileIDs: input.fileIds?.length ? input.fileIds : undefined,
    metadata: buildChatSendMetadata(input.locale, input.attachments),
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.chatSend, data });
}
