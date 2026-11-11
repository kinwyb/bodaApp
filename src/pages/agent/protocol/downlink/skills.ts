/**
 * 下行：agent.skills 响应 → 当前 agent 可选择的技能。
 */

import type { AgentSkill } from '../../types';
import type { AgentSkillsData } from '../payloads';

export type AgentSkillList = {
  agent: string;
  skills: AgentSkill[];
};

export function parseAgentSkills(data: unknown): AgentSkillList {
  const raw = (data ?? {}) as AgentSkillsData;
  const skills: AgentSkill[] = [];

  for (const item of raw.skills ?? []) {
    const name = item.name?.trim();
    if (!name || item.enabled === false) continue;
    skills.push({
      name,
      displayName: item.displayName?.trim() || undefined,
      description: item.description?.trim() || undefined,
      shortDescription: item.shortDescription?.trim() || undefined,
      path: item.path ?? '',
      scope: item.scope,
    });
  }

  return { agent: raw.agent?.trim() ?? '', skills };
}
