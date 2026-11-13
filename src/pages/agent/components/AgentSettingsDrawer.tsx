/**
 * 对话参数抽屉。
 *
 * 系统提示词、上下文长度、随机性后台 agent 暂不支持配置，先不展示；
 * 其余参数等后端约定后再由这里交给 chat hook（或 chat.send 的 metadata）。
 */

import React, { useState } from 'react';
import { Drawer, Flex, Select, Switch, Tag, Typography } from 'antd';
import type { AgentInfo } from '../types';
import { FALLBACK_AGENT_OPTIONS } from '../constants';
import { AGENT_CAPABILITIES } from '../mock/fixtures';
import { CapabilityIcon } from './AgentIcons';

const { Text, Title } = Typography;

export const AgentSettingsDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  agent: string;
  agents: AgentInfo[];
  onAgentChange: (name: string) => void;
}> = ({ open, onClose, agent, agents, onAgentChange }) => {
  const [streamEnabled, setStreamEnabled] = useState(true);

  const agentOptions =
    agents.length > 0
      ? agents.map((item) => ({ value: item.name, label: item.name, title: item.description }))
      : FALLBACK_AGENT_OPTIONS;
  const currentDescription =
    agents.find((item) => item.name === agent)?.description ?? '由服务端 hello 下发的 agent 列表';

  return (
    <Drawer title="对话参数" size={360} open={open} onClose={onClose} destroyOnHidden>
      <div className="agent-settings">
        <div className="agent-settings-item">
          <div className="agent-settings-label">
            <Text>Agent</Text>
            <Text type="secondary" className="agent-settings-hint">
              {currentDescription}
            </Text>
          </div>
          <Select
            value={agent || undefined}
            onChange={onAgentChange}
            placeholder="选择 agent"
            options={agentOptions}
            style={{ width: '100%' }}
          />
          <div className="agent-settings-hint">列表来自服务端 hello；本地演示为内置示例 agent。</div>
        </div>

        <div className="agent-settings-item agent-settings-row">
          <div>
            <Text>流式输出</Text>
            <div className="agent-settings-hint">关闭后等整段生成完再显示</div>
          </div>
          <Switch checked={streamEnabled} onChange={setStreamEnabled} />
        </div>

        <Title level={5} className="agent-settings-section">
          已接入能力
        </Title>
        <Flex vertical gap={8}>
          {AGENT_CAPABILITIES.map((item) => (
            <div className="agent-tool-row" key={item.key}>
              <span className="agent-tool-icon">
                <CapabilityIcon name={item.key} />
              </span>
              <div className="agent-tool-text">
                <Text>{item.label}</Text>
                <div className="agent-settings-hint">{item.description}</div>
              </div>
              <Tag color="green">已启用</Tag>
            </div>
          ))}
        </Flex>
      </div>
    </Drawer>
  );
};
