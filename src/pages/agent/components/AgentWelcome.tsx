/**
 * 空会话时的欢迎页：标题 + 快捷指令 + 能力卡片。
 */

import React, { useMemo } from 'react';
import { Avatar } from 'antd';
import { Prompts, Welcome } from '@ant-design/x';
import { RobotOutlined } from '@ant-design/icons';
import { AGENT_CAPABILITIES, AGENT_PROMPTS } from '../mock/fixtures';
import type { AgentPrompt } from '../mock/fixtures';
import { CapabilityIcon, PromptIcon } from './AgentIcons';

export const AgentWelcome: React.FC<{ onPick: (text: string) => void }> = ({ onPick }) => {
  const promptItems = useMemo(
    () =>
      AGENT_PROMPTS.map((prompt: AgentPrompt) => ({
        key: prompt.key,
        label: prompt.label,
        description: prompt.description,
        icon: <PromptIcon name={prompt.key} />,
      })),
    [],
  );

  return (
    <div className="agent-welcome">
      <Welcome
        className="agent-welcome-head"
        variant="borderless"
        // Welcome 根节点是 antd Flex（默认横排），要竖排居中只能走 style —— 内联优先级高于组件默认值
        style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
        icon={<Avatar className="agent-welcome-icon" size={56} icon={<RobotOutlined />} />}
        title="你好，我是 bodaWay 智造助手"
        description="可以帮你查预订单、分析产能、生成生产报表，也可以用一句话直接操作现有的表格视图。"
      />

      <Prompts
        className="agent-prompts"
        title="你可以这样问我"
        items={promptItems}
        wrap
        onItemClick={(info) => onPick(String(info.data.description ?? info.data.label ?? ''))}
      />

      <div className="agent-capabilities">
        {AGENT_CAPABILITIES.map((item) => (
          <div className="agent-capability" key={item.key}>
            <span className="agent-capability-icon">
              <CapabilityIcon name={item.key} />
            </span>
            <div>
              <div className="agent-capability-title">{item.label}</div>
              <div className="agent-capability-desc">{item.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
