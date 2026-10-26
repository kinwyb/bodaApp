/**
 * 上行命令：chat.cancel（中断当前会话）。
 *
 * 服务端优先用 sessionID，没有就用 chatID 自己推导（command.SessionKey）。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { ChatCancelData } from '../payloads';

export type ChatCancelInput = {
  chatID?: string;
  sessionID?: string;
};

export function buildChatCancel(input: ChatCancelInput): AgentEnvelope {
  const data: ChatCancelData = {
    sessionID: input.sessionID || undefined,
    chatID: input.chatID || undefined,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.chatCancel, data });
}
