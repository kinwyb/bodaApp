/**
 * 顶栏：会话标题 + 连接状态 + agent 选择 + 常用操作。
 */

import React, { useMemo } from 'react';
import { Button, Select, Space, Tag, Tooltip, Typography } from 'antd';
import {
  ClearOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { AgentConnectionStatus, AgentInfo } from '../types';
import { CONNECTION_META, FALLBACK_AGENT_OPTIONS } from '../constants';

const { Text } = Typography;

export const AgentHeader: React.FC<{
  title: string;
  messageCount: number;
  agent: string;
  agents: AgentInfo[];
  onAgentChange: (name: string) => void;
  connection: AgentConnectionStatus;
  mode: 'mock' | 'websocket';
  latency?: number;
  collapsed: boolean;
  onExpandSidebar: () => void;
  onOpenSettings: () => void;
  onClear: () => void;
  onCreate: () => void;
  onReconnect: () => void;
}> = ({
  title,
  messageCount,
  agent,
  agents,
  onAgentChange,
  connection,
  mode,
  latency,
  collapsed,
  onExpandSidebar,
  onOpenSettings,
  onClear,
  onCreate,
  onReconnect,
}) => {
  const agentOptions = useMemo(
    () =>
      agents.length > 0
        ? agents.map((item) => ({
            value: item.name,
            label: item.name,
            title: item.description ?? item.name,
          }))
        : FALLBACK_AGENT_OPTIONS,
    [agents],
  );

  const statusTag =
    mode === 'mock' ? { text: '演示模式', color: 'gold' } : CONNECTION_META[connection];

  return (
    <header className="agent-header">
      <div className="agent-header-left">
        {collapsed ? (
          <Button type="text" icon={<MenuUnfoldOutlined />} onClick={onExpandSidebar} />
        ) : null}
        <div className="agent-header-title">
          <Text strong ellipsis className="agent-header-name">
            {title}
          </Text>
          <span className="agent-header-sub">
            {messageCount > 0 ? `${messageCount} 条消息` : '新会话'} · {agent || '未选择 agent'}
            {latency !== undefined ? ` · ${latency}ms` : ''}
          </span>
        </div>
      </div>

      <Space size={8} wrap>
        <Tag color={statusTag.color} className="agent-status-tag">
          {statusTag.text}
        </Tag>
        {/* 鉴权失败 / 断线时给一个手动重连入口（重连会重新读 token） */}
        {mode === 'websocket' && connection === 'error' ? (
          <Button size="small" danger icon={<ReloadOutlined />} onClick={onReconnect}>
            重连
          </Button>
        ) : null}
        <Select
          className="agent-model-select"
          value={agent || undefined}
          onChange={onAgentChange}
          variant="borderless"
          popupMatchSelectWidth={260}
          placeholder="选择 agent"
          options={agentOptions}
        />
        <Tooltip title="对话参数">
          <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings} />
        </Tooltip>
        <Tooltip title="清空当前对话">
          <Button type="text" icon={<ClearOutlined />} onClick={onClear} />
        </Tooltip>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          新对话
        </Button>
      </Space>
    </header>
  );
};
