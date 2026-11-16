/**
 * 上行命令：chat.user_input（回传结构化提问的作答）。
 *
 * agent 调用 request_user_input 工具时会下发 user_input 帧并阻塞这一轮，
 * 用户作答后经它把答案送回去。requestID 就是下行 userInput.id；
 * answers 按问题 ID 组织，空对象表示跳过全部问题。
 * 会话推导与 chat.approval 一致：优先 sessionID，没有就用 chatID。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { ChatUserInputData } from '../payloads';

export type ChatUserInputInput = {
  chatID?: string;
  sessionID?: string;
  requestID: string;
  answers: Record<string, string[]>;
};

export function buildChatUserInput(input: ChatUserInputInput): AgentEnvelope {
  const data: ChatUserInputData = {
    sessionID: input.sessionID || undefined,
    chatID: input.chatID || undefined,
    requestID: input.requestID,
    answers: input.answers,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.chatUserInput, data });
}
