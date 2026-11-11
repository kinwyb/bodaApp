/**
 * Agent 输入框命令与技能。
 *
 * 命令只是消息正文的一部分，服务端按前缀识别：
 * - `/steer`：当前回答还在生成时补充引导；
 * - `$<skill-name>`：指定本轮使用的技能，候选来自 agent.skills。
 */

export const AGENT_STEER_COMMAND = '/steer';

/** 从可能已经带 `/steer` 的正文里取出真正的引导内容 */
export function steerGuidanceOf(text: string): string {
  return text
    .trim()
    .replace(/^\/steer(?:\s+|$)/i, '')
    .trim();
}

/** 服务端只认消息前缀，重复发送时不能再叠加一个 `/steer` */
export function composeSteerMessage(text: string): string {
  const guidance = steerGuidanceOf(text);
  return guidance ? `${AGENT_STEER_COMMAND} ${guidance}` : AGENT_STEER_COMMAND;
}

export function isSteerMessage(text: string): boolean {
  return /^\/steer(?:\s|$)/i.test(text.trim());
}
