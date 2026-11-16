/**
 * 下行事件：结构化提问（user_input）。
 *
 * 后端带上 userInput.id（回传用的请求标识）与问题列表（选项 / 自由文本）。
 * 实时到达的提问一律是 pending：agent 这一轮正被它阻塞，等用户作答后经
 * chat.user_input 回传。历史回放里的提问会在 frames.ts 里被置为 expired。
 */

import type { AgentUserInputQuestion } from '../../types';
import type { AgentEventHandler } from '../events';
import { AGENT_EVENT } from '../envelope';
import type { UserInputData } from '../payloads';

/** 只保留结构完整的问题：缺 id 或问题文本的条目无法作答，直接丢弃 */
function questionsOf(raw: UserInputData['questions']): AgentUserInputQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: AgentUserInputQuestion[] = [];
  for (const item of raw) {
    if (!item?.id || !item.question) continue;
    const options = Array.isArray(item.options)
      ? item.options
          .filter((option) => option?.label)
          .map((option) => ({ label: String(option.label), description: option.description }))
      : undefined;
    questions.push({
      id: item.id,
      header: item.header,
      question: item.question,
      options: options && options.length > 0 ? options : undefined,
    });
  }
  return questions;
}

export const mapUserInputEvent: AgentEventHandler = (name, data, conversationId) => {
  if (name !== AGENT_EVENT.userInput) return undefined;

  const userInput = data.userInput;
  const questions = questionsOf(userInput?.questions);
  if (!userInput?.id || questions.length === 0) return [];

  return [
    {
      type: 'user-input',
      conversationId,
      userInput: {
        id: userInput.id,
        questions,
        autoResolutionMs: userInput.autoResolutionMs,
        status: 'pending',
      },
    },
  ];
};
