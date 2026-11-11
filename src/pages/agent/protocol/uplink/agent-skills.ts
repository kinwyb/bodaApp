/**
 * 上行命令：agent.skills（拉取指定 agent 实际加载的技能）。
 */

import type { AgentEnvelope } from '../envelope';
import { CLIENT_TYPE, KIND, newEnvelope } from '../envelope';
import type { AgentSkillsData } from '../payloads';

export type AgentSkillsInput = {
  /** 为空时服务端使用默认 agent */
  agent?: string;
};

export function buildAgentSkills(input: AgentSkillsInput = {}): AgentEnvelope {
  const data: AgentSkillsData = {
    agent: input.agent || undefined,
  };
  return newEnvelope({ kind: KIND.client, type: CLIENT_TYPE.agentSkills, data });
}
