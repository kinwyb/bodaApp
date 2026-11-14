/**
 * Agent 输入框命令与技能。
 *
 * 命令只是消息正文的一部分，服务端按前缀识别：
 * - `/steer`：当前回答还在生成时补充引导；
 * - `$<skill-name>`：指定本轮使用的技能，候选来自 agent.skills。
 */

export const AGENT_STEER_COMMAND = '/steer';

/**
 * 从可能已经带 `/steer` 的正文里取出真正的引导内容。
 *
 * 要兼容两类脏输入，否则前缀会被一路带进发给 agent 的正文里：
 * - `/steer` 后没有空格：输入框曾打不出空格，正文会紧挨着命令（如 `/steer设置错了`）；
 * - 叠了多个 `/steer`（如 `/steer /steer …`）。
 * 这里逐个剥掉开头的命令前缀，保证剩下的就是纯引导内容。
 */
export function steerGuidanceOf(text: string): string {
  let result = text.trim();
  while (result.toLowerCase().startsWith(AGENT_STEER_COMMAND)) {
    result = result.slice(AGENT_STEER_COMMAND.length).trim();
  }
  return result;
}

/** 服务端只认消息前缀，重复发送时不能再叠加一个 `/steer` */
export function composeSteerMessage(text: string): string {
  const guidance = steerGuidanceOf(text);
  return guidance ? `${AGENT_STEER_COMMAND} ${guidance}` : AGENT_STEER_COMMAND;
}

export function isSteerMessage(text: string): boolean {
  return text.trim().toLowerCase().startsWith(AGENT_STEER_COMMAND);
}
