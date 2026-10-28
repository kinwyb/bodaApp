/**
 * 顶栏：会话标题 + 连接状态 + 会话记录入口 + agent 选择 + 常用操作。
 *
 * 会话的「新建 / 历史」由外部传入的 conversationSlot 承载（见 AgentConversationPanel），
 * 这里不关心它长什么样，只负责给它一个位置。
 */

import React, { useMemo } from 'react';
import { Button, Dropdown, Select, Space, Tag, Tooltip, Typography } from 'antd';
import {
  ClearOutlined,
  EllipsisOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { AgentConnectionStatus, AgentInfo } from '../types';
import { CONNECTION_HINT, CONNECTION_META, FALLBACK_AGENT_OPTIONS } from '../constants';

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
  /** 紧凑形态（嵌在工作台左栏时）：标题更短、agent 下拉更窄、按钮只留图标 */
  compact?: boolean;
  /** 会话记录入口（弹出新建 + 历史会话） */
  conversationSlot?: React.ReactNode;
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
  compact = false,
  conversationSlot,
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
  /** 断开状态下，状态标签本身也当作重连入口（最不容易被忽略的那个位置） */
  const tagClickable = mode === 'websocket' && (connection === 'error' || connection === 'idle');

  /**
   * 副标题：紧凑形态里省掉 agent 名字 —— 它就在右边的下拉里，
   * 再写一遍在 480px 的面板里会把副标题挤成两行。
   */
  const subtitle = [
    messageCount > 0 ? `${messageCount} 条消息` : '新会话',
    compact ? '' : agent || '未选择 agent',
    latency !== undefined ? `${latency}ms` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <header className={`agent-header${compact ? ' agent-header-compact' : ''}`}>
      <div className="agent-header-left">
        <div className="agent-header-title">
          <Text strong ellipsis className="agent-header-name">
            {title}
          </Text>
          <span className="agent-header-sub">{subtitle}</span>
        </div>
      </div>

      <Space size={8} wrap>
        {/* 状态标签：断开时说明会自动重试，且可以直接点它重连 */}
        <Tooltip
          title={
            mode === 'mock'
              ? '当前是本地演示数据'
              : tagClickable
                ? `${CONNECTION_HINT[connection]}（点击可重连）`
                : CONNECTION_HINT[connection]
          }
        >
          <Tag
            color={statusTag.color}
            className={`agent-status-tag${tagClickable ? ' agent-status-tag-clickable' : ''}`}
            onClick={tagClickable ? onReconnect : undefined}
          >
            {statusTag.text}
          </Tag>
        </Tooltip>
        {/* 会话记录入口（新建 / 历史），由 AgentConversationPanel 提供 */}
        {conversationSlot}
        {/*
          断开入口：idle（未连接）和 error（连接异常）都必须有，而且紧凑形态也要给 ——
          缩成纯图标（约 32px）就不会把 60px 的顶栏挤换行，
          「后端重启后停在未连接、页面上没有任何地方可点」就是这么来的。
        */}
        {mode === 'websocket' && (connection === 'error' || connection === 'idle') ? (
          compact ? (
            <Tooltip title={connection === 'error' ? '连接异常，点击重连' : '未连接，点击连接'}>
              <Button
                size="small"
                type="text"
                danger={connection === 'error'}
                icon={<ReloadOutlined />}
                onClick={onReconnect}
              />
            </Tooltip>
          ) : (
            <Button
              size="small"
              danger={connection === 'error'}
              icon={<ReloadOutlined />}
              onClick={onReconnect}
            >
              {connection === 'error' ? '重连' : '连接'}
            </Button>
          )
        ) : null}
        <Select
          className={`agent-model-select${compact ? ' agent-model-select-compact' : ''}`}
          value={agent || undefined}
          onChange={onAgentChange}
          variant="borderless"
          popupMatchSelectWidth={260}
          placeholder="选择 agent"
          options={agentOptions}
        />
        {/*
          紧凑形态把「对话参数 / 清空」收进一个更多菜单：
          480px 的面板里，四个按钮并排会顶到换行（顶栏变成两行）。
        */}
        {compact ? (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'settings',
                  icon: <SettingOutlined />,
                  label: '对话参数',
                  onClick: onOpenSettings,
                },
                {
                  key: 'clear',
                  icon: <ClearOutlined />,
                  label: '清空当前对话',
                  onClick: onClear,
                },
              ],
            }}
          >
            <Button type="text" icon={<EllipsisOutlined />} />
          </Dropdown>
        ) : (
          <>
            <Tooltip title="对话参数">
              <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings} />
            </Tooltip>
            <Tooltip title="清空当前对话">
              <Button type="text" icon={<ClearOutlined />} onClick={onClear} />
            </Tooltip>
          </>
        )}
        {/* 紧凑形态里「新建对话」就在会话浮层顶部，顶栏不再放一个重复按钮 */}
        {compact ? null : (
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            新对话
          </Button>
        )}
      </Space>
    </header>
  );
};
