/**
 * 左侧栏：品牌 + 会话列表 + 底部用户入口。
 *
 * 折叠态只留两个按钮（新建 / 展开），避免窄条里塞不下菜单。
 */

import React, { useCallback, useMemo } from 'react';
import { Avatar, Button, Dropdown, Flex, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Conversations } from '@ant-design/x';
import type { ConversationItemType } from '@ant-design/x';
import type { AgentConversation } from '../types';
import { CONVERSATION_MENU_KEYS } from '../constants';

export const AgentSidebar: React.FC<{
  conversations: AgentConversation[];
  activeKey: string;
  collapsed: boolean;
  /** 服务端 hello 下发的用户身份（token 解析而来） */
  userId?: string;
  onToggleCollapsed: () => void;
  onSwitch: (key: string) => void;
  onCreate: () => void;
  onRename: (key: string) => void;
  onDelete: (key: string) => void;
  onOpenLegacy: () => void;
}> = ({
  conversations,
  activeKey,
  collapsed,
  userId,
  onToggleCollapsed,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onOpenLegacy,
}) => {
  /** 会话列表：按更新时间倒序 */
  const items = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((conversation) => ({
          key: conversation.key,
          label: conversation.label,
          group: conversation.group,
          icon: <MessageOutlined />,
        })),
    [conversations],
  );

  const conversationMenu = useCallback(
    (conversation: ConversationItemType): MenuProps => ({
      items: [
        { key: CONVERSATION_MENU_KEYS.rename, label: '重命名', icon: <EditOutlined /> },
        { key: CONVERSATION_MENU_KEYS.delete, label: '删除', icon: <DeleteOutlined />, danger: true },
      ],
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === CONVERSATION_MENU_KEYS.rename) {
          onRename(conversation.key);
          return;
        }
        onDelete(conversation.key);
      },
    }),
    [onDelete, onRename],
  );

  const userMenu: MenuProps = {
    items: [
      {
        key: 'legacy',
        label: '返回管理后台',
        icon: <MenuUnfoldOutlined />,
        onClick: onOpenLegacy,
      },
    ],
  };

  return (
    <aside className={`agent-sider${collapsed ? ' agent-sider-collapsed' : ''}`}>
      <div className="agent-brand">
        <Avatar className="agent-brand-logo" shape="square" size={32} icon={<RobotOutlined />} />
        {collapsed ? null : (
          <div className="agent-brand-text">
            <div className="agent-brand-name">bodaWay</div>
            <div className="agent-brand-tip">智造助手</div>
          </div>
        )}
      </div>

      {collapsed ? (
        <Flex vertical className="agent-sider-mini" gap={8}>
          <Tooltip title="新建对话" placement="right">
            <Button block icon={<PlusOutlined />} onClick={onCreate} />
          </Tooltip>
          <Tooltip title="展开侧栏" placement="right">
            <Button block type="text" icon={<MenuUnfoldOutlined />} onClick={onToggleCollapsed} />
          </Tooltip>
        </Flex>
      ) : (
        <>
          <Conversations
            className="agent-conversations"
            items={items}
            activeKey={activeKey}
            onActiveChange={(key) => onSwitch(key)}
            groupable={{ label: (group) => <span className="agent-conv-group">{group}</span> }}
            creation={{ label: '新建对话', icon: <PlusOutlined />, onClick: onCreate }}
            menu={conversationMenu}
          />
          <div className="agent-sider-footer">
            <Dropdown menu={userMenu} placement="topLeft" trigger={['click']}>
              <button type="button" className="agent-user" title={userId ? `当前连接用户：${userId}` : undefined}>
                <Avatar size={28} icon={<UserOutlined />} />
                <span className="agent-user-name">{userId || '车间管理员'}</span>
                <MoreOutlined className="agent-user-more" />
              </button>
            </Dropdown>
            <Tooltip title="收起侧栏">
              <Button type="text" size="small" icon={<MenuFoldOutlined />} onClick={onToggleCollapsed} />
            </Tooltip>
          </div>
        </>
      )}
    </aside>
  );
};
