/**
 * Agent 输入框命令与技能。
 *
 * 命令只是消息正文的一部分，服务端按前缀识别：
 * - `/steer`：当前回答还在生成时补充引导；
 * - `$ui-operation`：直接启用界面观察与操作技能。
 */

export const AGENT_STEER_COMMAND = '/steer';
export const AGENT_UI_SKILL = '$ui-operation';

export type AgentSkillOption = {
  key: string;
  token: string;
  label: string;
  description: string;
};

export const AGENT_SKILL_OPTIONS: AgentSkillOption[] = [
  {
    key: 'ui-operation',
    token: AGENT_UI_SKILL,
    label: 'UI 操作',
    description: '观察页面、取数据并执行界面命令',
  },
];

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
